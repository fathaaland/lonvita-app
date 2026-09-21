import { z } from 'zod';
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 128;
const MAX_TOKEN_LENGTH = 128;
export const passwordSchema = z
    .string()
    .min(8, 'Heslo musí mít alespoň 8 znaků')
    .max(MAX_PASSWORD_LENGTH, 'Heslo je příliš dlouhé');
const tokenSchema = z
    .string()
    .trim()
    .min(1, 'Chybí token pro obnovení hesla')
    .max(MAX_TOKEN_LENGTH, 'Token pro obnovení hesla je neplatný');
export const forgotPasswordInputSchema = z.object({
    email: z
        .string()
        .trim()
        .toLowerCase()
        .max(MAX_EMAIL_LENGTH, 'E-mailová adresa je příliš dlouhá')
        .email('Zadejte platnou e-mailovou adresu'),
});
export const resetPasswordInputSchema = z.object({
    token: tokenSchema,
    password: passwordSchema,
});
export const resetPasswordFormSchema = z
    .object({
    password: passwordSchema,
    passwordConfirm: passwordSchema,
})
    .refine((data) => data.password === data.passwordConfirm, {
    message: 'Hesla se neshodují',
    path: ['passwordConfirm'],
});
