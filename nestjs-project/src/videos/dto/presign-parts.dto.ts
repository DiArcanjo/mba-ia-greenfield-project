import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsInt,
  Min,
} from 'class-validator';

export const MAX_PARTS_PER_PRESIGN_REQUEST = 100;

export class PresignPartsDto {
  /** Part numbers (1-based) to presign; each must not exceed the upload's partCount. */
  @IsInt({ each: true })
  @Min(1, { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PARTS_PER_PRESIGN_REQUEST)
  @ArrayUnique()
  partNumbers: number[];
}
