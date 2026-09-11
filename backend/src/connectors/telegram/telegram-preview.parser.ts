import * as cheerio from 'cheerio';
import { PostType } from '../../db/entities/post.entity';
import { parseCompactNumber } from './compact-number';

export interface ParsedPreviewPost {
  externalPostId: string;
  publishedAt: Date;
  caption: string | null;
  thumbnailUrl: string | null;
  views: number | null;
  reactions: number;
  type: PostType;
  permalink: string;
  /** One part of an album. The preview page shows an album once; embed pages show each part. */
  grouped: boolean;
}

/** The page loaded but held no posts: markup changed, or the channel hid its preview. */
export class PreviewUnavailableError extends Error {}

const BACKGROUND_URL = /background-image:url\('([^']+)'\)/;

function backgroundUrl(style: string | undefined): string | null {
  const match = style ? BACKGROUND_URL.exec(style) : null;
  return match ? match[1] : null;
}

/**
 * data-view is base64 JSON such as {"c":-123,"p":"825g",...}. Telegram writes the
 * post id as a string with a trailing "g" when the post is part of an album.
 */
function isAlbumPart(dataView: string | undefined): boolean {
  if (!dataView) return false;
  try {
    const { p } = JSON.parse(Buffer.from(dataView, 'base64').toString('utf-8'));
    return typeof p === 'string' && p.endsWith('g');
  } catch {
    return false;
  }
}

export function parsePreviewPage(
  html: string,
  channel: string,
): ParsedPreviewPost[] {
  const $ = cheerio.load(html);
  const posts: ParsedPreviewPost[] = [];

  $('.tgme_widget_message[data-post]').each((_, element) => {
    const message = $(element);
    const dataPost = message.attr('data-post') ?? '';
    const externalPostId = dataPost.split('/').pop() ?? '';
    const datetime = message.find('time[datetime]').attr('datetime');
    if (!externalPostId || !datetime) return;

    const photo = backgroundUrl(
      message.find('.tgme_widget_message_photo_wrap').attr('style'),
    );
    const video = backgroundUrl(
      message.find('.tgme_widget_message_video_thumb').attr('style'),
    );

    let type = PostType.POST;
    if (video) type = PostType.VIDEO;
    else if (photo) type = PostType.IMAGE;

    let reactions = 0;
    // Paid reactions count Stars sent, not people reacting, so one donor can add
    // tens of thousands to a post. Excluding them keeps reactions a measure of engagement.
    message
      .find('.tgme_reaction:not(.tgme_reaction_paid)')
      .each((_i, reaction) => {
        // Only the span's own text is the count. Its child element is the emoji,
        // and a standard emoji renders as text ("🔥"), which would spoil the number.
        const count = $(reaction)
          .contents()
          .filter((_j, node) => node.type === 'text')
          .text();
        reactions += parseCompactNumber(count) ?? 0;
      });

    const messageText = message.find('.tgme_widget_message_text').first();
    // .text() drops <br/> entirely, running consecutive lines together — replace
    // each one with a newline first so multi-paragraph captions survive.
    messageText.find('br').replaceWith('\n');
    const caption = messageText.text().trim();

    posts.push({
      externalPostId,
      publishedAt: new Date(datetime),
      caption: caption.length > 0 ? caption : null,
      thumbnailUrl: video ?? photo,
      views: parseCompactNumber(
        message.find('.tgme_widget_message_views').first().text(),
      ),
      reactions,
      type,
      permalink: `https://t.me/${channel}/${externalPostId}`,
      grouped: isAlbumPart(message.attr('data-view')),
    });
  });

  if (posts.length === 0) {
    throw new PreviewUnavailableError(
      `No posts found on the preview page for ${channel} — the channel may have disabled its web preview, or Telegram changed the page markup.`,
    );
  }

  return posts;
}
