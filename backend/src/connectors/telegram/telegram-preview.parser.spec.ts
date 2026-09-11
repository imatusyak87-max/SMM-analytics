import { readFileSync } from 'fs';
import { join } from 'path';
import { PostType } from '../../db/entities/post.entity';
import {
  parsePreviewPage,
  PreviewUnavailableError,
} from './telegram-preview.parser';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');

describe('parsePreviewPage', () => {
  const posts = () =>
    parsePreviewPage(fixture('preview-page.html'), 'testchannel');

  it('reads every post on the page, newest last as rendered', () => {
    expect(posts().map((p) => p.externalPostId)).toEqual(['101', '102', '103']);
  });

  it('reads the exact publication time, not just the date', () => {
    expect(posts()[1].publishedAt.toISOString()).toBe(
      '2026-09-02T12:30:45.000Z',
    );
  });

  it('reads text, views and the summed reaction counts', () => {
    const post = posts()[1];
    expect(post.caption).toBe('Пост с картинкой\nВторая строка');
    expect(post.views).toBe(12300);
    expect(post.reactions).toBe(1248);
  });

  // The fixture's post 102 has a <br/> between two lines of text. cheerio's
  // .text() drops <br/> entirely, running the lines together, so the modal's
  // white-space: pre-wrap never sees a line break to render.
  it('keeps a line break from a <br/> in the caption instead of dropping it', () => {
    const post = posts()[1];
    expect(post.caption).toContain('\n');
    expect(post.caption).toBe('Пост с картинкой\nВторая строка');
  });

  it('reports no reactions as zero rather than as missing', () => {
    expect(posts()[2].reactions).toBe(0);
  });

  // A paid reaction counts Stars sent, not people reacting, so one donor can add
  // tens of thousands to a post. Excluded, so reactions measure engagement.
  it('excludes paid Stars reactions from the reaction count', () => {
    expect(posts()[1].reactions).toBe(1248);
  });

  // Standard emoji reactions render the emoji itself as text inside the span
  // (<i class="emoji"><b>🔥</b></i>3), unlike custom emoji, whose <tg-emoji> is
  // empty. Reading the span's whole text gave "🔥3", which parses as no number —
  // so every channel using plain emoji reactions stored 0 reactions.
  it('counts standard emoji reactions, whose emoji is rendered as text', () => {
    const html = `
      <div class="tgme_widget_message" data-post="testchannel/579">
        <div class="tgme_widget_message_reactions js-message_reactions">
          <span class="tgme_reaction"><i class="emoji" style="background-image:url('//telegram.org/img/emoji/40/F09F94A5.png')"><b>🔥</b></i>3</span><span class="tgme_reaction"><i class="emoji" style="background-image:url('//telegram.org/img/emoji/40/F09F9881.png')"><b>😁</b></i>2</span>
        </div>
        <span class="tgme_widget_message_views">184</span>
        <time datetime="2026-06-24T16:01:06+00:00"></time>
      </div>`;
    expect(parsePreviewPage(html, 'testchannel')[0].reactions).toBe(5);
  });

  it('types a post by its media: photos are IMAGE, video is VIDEO, neither is POST', () => {
    expect(posts().map((p) => p.type)).toEqual([
      PostType.POST,
      PostType.IMAGE,
      PostType.VIDEO,
    ]);
  });

  it('takes the image from a photo post and the thumbnail from a video', () => {
    expect(posts()[1].thumbnailUrl).toBe(
      'https://cdn4.telesco.pe/file/photo102',
    );
    expect(posts()[2].thumbnailUrl).toBe(
      'https://cdn4.telesco.pe/file/video103',
    );
    expect(posts()[0].thumbnailUrl).toBeNull();
  });

  it('builds a permalink back to the post', () => {
    expect(posts()[0].permalink).toBe('https://t.me/testchannel/101');
  });

  // A page with no posts means the markup changed or the channel hid its preview.
  // Returning [] would be indistinguishable from a channel that simply went quiet.
  it('throws rather than returning nothing when the page holds no posts', () => {
    expect(() =>
      parsePreviewPage(fixture('preview-unavailable.html'), 'testchannel'),
    ).toThrow(PreviewUnavailableError);
  });

  it('marks ordinary posts as not part of an album', () => {
    expect(posts().map((p) => p.grouped)).toEqual([false, false, false]);
  });
});

// A channel that disabled its web preview still serves each post's embed page
// (t.me/<channel>/<id>?embed=1). These fixtures are real pages from @ehinaceya.
describe('parsePreviewPage on a single-post embed page', () => {
  it('reads the one post the embed shows', () => {
    const [post] = parsePreviewPage(fixture('embed-post.html'), 'ehinaceya');

    expect(post.externalPostId).toBe('842');
    expect(post.publishedAt.toISOString()).toBe('2026-09-09T17:32:30.000Z');
    expect(post.views).toBe(145);
    expect(post.grouped).toBe(false);
  });

  // Every part of an album has its own id and embed page, each repeating the
  // album's views and reactions. The walk must know a page is an album part to
  // count the album once.
  it('marks a post that is one part of an album', () => {
    const [post] = parsePreviewPage(
      fixture('embed-album-part.html'),
      'ehinaceya',
    );

    expect(post.externalPostId).toBe('826');
    expect(post.grouped).toBe(true);
  });

  it('throws for a deleted or not-yet-published post, whose embed says "Post not found"', () => {
    expect(() =>
      parsePreviewPage(fixture('embed-not-found.html'), 'ehinaceya'),
    ).toThrow(PreviewUnavailableError);
  });
});
