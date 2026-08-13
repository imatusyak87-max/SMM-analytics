import { PostType } from '../../db/entities/post.entity';

interface TelegramMessage {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  video?: unknown;
  photo?: unknown;
  media_group_id?: string;
}

export interface MappedTelegramPost {
  externalPostId: string;
  type: PostType;
  publishedAt: Date;
  permalink: string;
  caption: string | null;
  likes: number;
  comments: number;
  shares: number;
  views: number | null;
  reach: number | null;
}

export function mapTelegramMessageToPost(message: TelegramMessage, channelUsername: string): MappedTelegramPost {
  let type = PostType.POST;
  if (message.media_group_id) type = PostType.CAROUSEL;
  else if (message.video) type = PostType.VIDEO;

  return {
    externalPostId: String(message.message_id),
    type,
    publishedAt: new Date(message.date * 1000),
    permalink: `https://t.me/${channelUsername.replace('@', '')}/${message.message_id}`,
    caption: message.text ?? message.caption ?? null,
    likes: 0,
    comments: 0,
    shares: 0,
    views: null,
    reach: null,
  };
}
