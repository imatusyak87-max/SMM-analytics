import { mapInstagramPost } from './instagram-post-mapper';
import { PostType } from '../../db/entities/post.entity';
import { InstagramMedia, InstagramMediaInsights } from './instagram-api.client';

const baseMedia: InstagramMedia = {
  id: 'media-1',
  caption: 'A post about coffee',
  mediaType: 'IMAGE',
  mediaProductType: 'FEED',
  mediaUrl: 'https://cdn/img.jpg',
  thumbnailUrl: null,
  permalink: 'https://instagram.com/p/abc',
  timestamp: '2026-09-01T10:00:00+0000',
  likeCount: 40,
  commentsCount: 3,
};
const insights: InstagramMediaInsights = { reach: 500, saved: 12, shares: 4 };

describe('mapInstagramPost', () => {
  it('maps an image post', () => {
    const post = mapInstagramPost(baseMedia, insights);

    expect(post).toEqual({
      externalPostId: 'media-1',
      type: PostType.IMAGE,
      publishedAt: new Date('2026-09-01T10:00:00+0000'),
      permalink: 'https://instagram.com/p/abc',
      thumbnailUrl: 'https://cdn/img.jpg',
      caption: 'A post about coffee',
      likes: 40,
      comments: 3,
      shares: 4,
      views: null,
      reach: 500,
    });
  });

  it('prefers thumbnailUrl over mediaUrl when both are present (video)', () => {
    const video = { ...baseMedia, mediaType: 'VIDEO', mediaUrl: 'https://cdn/vid.mp4', thumbnailUrl: 'https://cdn/thumb.jpg' };

    expect(mapInstagramPost(video, insights).thumbnailUrl).toBe('https://cdn/thumb.jpg');
    expect(mapInstagramPost(video, insights).type).toBe(PostType.VIDEO);
  });

  it('maps a reel by media_product_type, not media_type', () => {
    const reel = { ...baseMedia, mediaType: 'VIDEO', mediaProductType: 'REELS' };

    expect(mapInstagramPost(reel, insights).type).toBe(PostType.REEL);
  });

  it('maps a carousel album', () => {
    const carousel = { ...baseMedia, mediaType: 'CAROUSEL_ALBUM' };

    expect(mapInstagramPost(carousel, insights).type).toBe(PostType.CAROUSEL);
  });

  it('treats a missing insights metric as null, not zero', () => {
    const noReach = { reach: null, saved: 5, shares: null };

    const post = mapInstagramPost(baseMedia, noReach);

    expect(post.reach).toBeNull();
  });
});
