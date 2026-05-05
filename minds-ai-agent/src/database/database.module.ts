import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mysql from 'mysql2/promise';
import { drizzle, MySql2Database } from 'drizzle-orm/mysql2';

export const DRIZZLE = Symbol('DRIZZLE');

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<MySql2Database> => {
        const pool = mysql.createPool({
          host: config.get<string>('MARIADB_HOST', 'localhost'),
          port: config.get<number>('MARIADB_PORT', 3306),
          user: config.get<string>('MARIADB_USER', 'root'),
          password: config.get<string>('MARIADB_PASSWORD', ''),
          database: config.get<string>('MARIADB_DATABASE', 'minds'),
          waitForConnections: true,
          connectionLimit: 10,
        });
        return drizzle(pool);
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
