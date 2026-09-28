import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/** Cuerpo de POST /users */
export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsEmail()
  @MaxLength(160)
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}
