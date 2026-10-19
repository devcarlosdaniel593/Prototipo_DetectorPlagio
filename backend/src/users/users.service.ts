import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateUserDto } from './create-user.dto';
import { hashPassword } from './password.util';

/** Campos que se pueden devolver por la API. La contraseña nunca sale. */
const PUBLIC_USER_FIELDS = {
  id: true,
  name: true,
  email: true,
  createdAt: true,
} as const;

/**
 * Gestión de usuarios en la tabla User. Las respuestas nunca incluyen la
 * contraseña (select con PUBLIC_USER_FIELDS).
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.user.findMany({
      select: PUBLIC_USER_FIELDS,
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Crea un usuario: normaliza nombre y correo (correo en minúsculas) y
   * guarda la contraseña con hashPassword.
   * @throws ConflictException (409) si el correo ya existe (error P2002 de Prisma).
   */
  async create(data: CreateUserDto) {
    try {
      return await this.prisma.user.create({
        data: {
          name: data.name.trim(),
          email: data.email.trim().toLowerCase(),
          password: await hashPassword(data.password),
        },
        select: PUBLIC_USER_FIELDS,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ya existe un usuario con ese correo');
      }
      throw error;
    }
  }
}
