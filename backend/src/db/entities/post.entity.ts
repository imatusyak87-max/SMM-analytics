import { Entity, PrimaryGeneratedColumn, Column, Unique } from 'typeorm';

export enum PostType {
  POST = 'post',
  REEL = 'reel',
  CAROUSEL = 'carousel',
  VIDEO = 'video',
  SHORT = 'short',
  STORY = 'story',
}

@Entity('posts')
@Unique(['accountId', 'externalPostId'])
export class Post {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') accountId: string;
  @Column() externalPostId: string;
  @Column({ type: 'enum', enum: PostType }) type: PostType;
  @Column({ type: 'timestamptz' }) publishedAt: Date;
  @Column({ nullable: true, type: 'text' }) permalink: string | null;
  @Column({ nullable: true, type: 'text' }) thumbnailUrl: string | null;
  @Column({ nullable: true, type: 'text' }) caption: string | null;
  @Column('int', { default: 0 }) likes: number;
  @Column('int', { default: 0 }) comments: number;
  @Column('int', { default: 0 }) shares: number;
  @Column('int', { nullable: true }) views: number | null;
  @Column('int', { nullable: true }) reach: number | null;
  @Column('float', { nullable: true }) er: number | null;
  @Column({ type: 'timestamptz' }) lastSyncedAt: Date;
}
