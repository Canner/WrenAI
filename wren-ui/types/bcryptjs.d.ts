declare module 'bcryptjs' {
  interface BcryptJS {
    genSalt(rounds?: number): Promise<string>;
    hash(data: string, saltOrRounds: string | number): Promise<string>;
    compare(data: string, encrypted: string): Promise<boolean>;
    genSaltSync(rounds?: number): string;
    hashSync(data: string, saltOrRounds: string | number): string;
    compareSync(data: string, encrypted: string): boolean;
  }

  const bcrypt: BcryptJS;
  export default bcrypt;
}
