/** A Telegram round video message («кружочек»): no text, a round preview image. */
export function isRoundVideo(post: { type: string }): boolean {
  return post.type === 'round_video';
}
