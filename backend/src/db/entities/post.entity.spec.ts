import { PostType } from './post.entity';

describe('PostType', () => {
  it('has an IMAGE type covering photo posts, whether one photo or several', () => {
    expect(PostType.IMAGE).toBe('image');
  });
});
