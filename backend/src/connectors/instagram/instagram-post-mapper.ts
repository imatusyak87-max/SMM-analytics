import { ConnectorPost } from '../connector.interface';
import { PostType } from '../../db/entities/post.entity';
import { InstagramMedia, InstagramMediaInsights } from './instagram-api.client';

function mapType(media: InstagramMedia): PostType {
  // media_product_type distinguishes a Reel from an ordinary video upload;
  // media_type alone cannot, since both report VIDEO.
  if (media.mediaProductType === 'REELS') return PostType.REEL;
  switch (media.mediaType) {
    case 'IMAGE':
      return PostType.IMAGE;
    case 'VIDEO':
      return PostType.VIDEO;
    case 'CAROUSEL_ALBUM':
      return PostType.CAROUSEL;
    default:
      return PostType.POST;
  }
}

export function mapInstagramPost(media: InstagramMedia, insights: InstagramMediaInsights): ConnectorPost {
  return {
    externalPostId: media.id,
    type: mapType(media),
    publishedAt: new Date(media.timestamp),
    permalink: media.permalink,
    // A video's own URL points at the file, not something a browser can render
    // as a preview image — prefer the thumbnail whenever Instagram supplies one.
    thumbnailUrl: media.thumbnailUrl ?? media.mediaUrl,
    caption: media.caption,
    likes: media.likeCount,
    comments: media.commentsCount,
    shares: insights.shares ?? 0,
    views: null,
    reach: insights.reach,
  };
}
