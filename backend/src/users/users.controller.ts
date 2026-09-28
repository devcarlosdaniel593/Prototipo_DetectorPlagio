import { Body, Controller, Get, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './create-user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Lista de usuarios sin contraseñas. */
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  /** Crea un usuario; la contraseña se guarda cifrada (scrypt). */
  @Post()
  create(@Body() body: CreateUserDto) {
    return this.usersService.create(body);
  }
}
