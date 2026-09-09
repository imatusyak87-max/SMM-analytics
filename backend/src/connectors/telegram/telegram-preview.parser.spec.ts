import { readFileSync } from 'fs';
import { join } from 'path';
import { PostType } from '../../db/entities/post.entity';
import { parsePreviewPage, PreviewUnavailableError } from './telegram-preview.parser';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');

describe('parsePreviewPage', () => {
  const posts = () => parsePreviewPage(fixture('preview-page.html'), 'testchannel');

  it('reads every post on the page, newest last as rendered', () => {
    expect(posts().map((p) => p.externalPostId)).toEqual(['101', '102', '103']);
  });

  it('reads the exact publication time, not just the date', () => {
    expect(posts()[1].publishedAt.toISOString()).toBe('2026-09-02T12:30:45.000Z');
  });

  it('reads text, views and the summed reaction counts', () => {
    const post = posts()[1];
    expect(post.caption).toBe('Пост с картинкой');
    expect(post.views).toBe(12300);
    expect(post.reactions).toBe(1248);
  });

  it('reports no reactions as zero rather than as missing', () => {
    expect(posts()[2].reactions).toBe(0);
  });

  it('types a post by its media: photos are IMAGE, video is VIDEO, neither is POST', () => {
    expect(posts().map((p) => p.type)).toEqual([PostType.POST, PostType.IMAGE, PostType.VIDEO]);
  });

  it('takes the image from a photo post and the thumbnail from a video', () => {
    expect(posts()[1].thumbnailUrl).toBe('https://cdn4.telesco.pe/file/photo102');
    expect(posts()[2].thumbnailUrl).toBe('https://cdn4.telesco.pe/file/video103');
    expect(posts()[0].thumbnailUrl).toBeNull();
  });

  it('builds a permalink back to the post', () => {
    expect(posts()[0].permalink).toBe('https://t.me/testchannel/101');
  });

  // A page with no posts means the markup changed or the channel hid its preview.
  // Returning [] would be indistinguishable from a channel that simply went quiet.
  it('throws rather than returning nothing when the page holds no posts', () => {
    expect(() => parsePreviewPage(fixture('preview-unavailable.html'), 'testchannel')).toThrow(
      PreviewUnavailableError,
    );
  });
});
