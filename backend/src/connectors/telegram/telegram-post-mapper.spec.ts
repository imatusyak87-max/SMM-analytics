import { mapTelegramMessageToPost } from './telegram-post-mapper';
import { PostType } from '../../db/entities/post.entity';

describe('mapTelegramMessageToPost', () => {
  it('maps a text-only post to type "post"', () => {
    const message = { message_id: 42, date: 1755000000, text: 'Hello world' };
    const result = mapTelegramMessageToPost(message, '@testchannel');
    expect(result.externalPostId).toBe('42');
    expect(result.type).toBe(PostType.POST);
    expect(result.caption).toBe('Hello world');
    expect(result.likes).toBe(0);
    expect(result.views).toBeNull();
  });

  it('maps a video message to type "video"', () => {
    const message = { message_id: 43, date: 1755000000, caption: 'A video', video: { file_id: 'v1' } };
    const result = mapTelegramMessageToPost(message, '@testchannel');
    expect(result.type).toBe(PostType.VIDEO);
  });

  it('maps a media_group (album) message to type "carousel"', () => {
    const message = { message_id: 44, date: 1755000000, media_group_id: 'g1', photo: [{ file_id: 'p1' }] };
    const result = mapTelegramMessageToPost(message, '@testchannel');
    expect(result.type).toBe(PostType.CAROUSEL);
  });
});
