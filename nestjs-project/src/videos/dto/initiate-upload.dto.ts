import { IsInt, IsString, Length, Matches, Min } from 'class-validator';

export class InitiateUploadDto {
  /** Original file name, including extension. */
  @IsString()
  @Length(1, 255)
  filename: string;

  /** Video MIME type. */
  @IsString()
  @Matches(/^video\/[A-Za-z0-9.+-]+$/)
  contentType: string;

  /** File size in bytes. */
  @IsInt()
  @Min(1)
  size: number;
}
