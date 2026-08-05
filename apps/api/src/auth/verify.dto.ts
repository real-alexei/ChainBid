import { IsString } from 'class-validator'

export class VerifyDto {
  @IsString()
  message!: string

  @IsString()
  signature!: string
}
