import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** A client project; groups its accounts across networks. Hidden, not deleted, when the user deletes it. */
@Entity('profiles')
export class Profile {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
}
