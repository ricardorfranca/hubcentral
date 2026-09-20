/**
 * @file password.ts
 * @module core/iam
 *
 * Hashing e verificação de senhas usando scrypt nativo do Node (sem dependência
 * externa). O hash é armazenado no formato `salt:derived`, ambos em hex.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Tamanho do salt em bytes. */
const SALT_BYTES = 16;
/** Tamanho da chave derivada em bytes. */
const KEY_LEN = 64;
/** Comprimento mínimo de senha (§5.6 do CRM: mínimo 6 caracteres). */
export const MIN_PASSWORD_LENGTH = 6;

/**
 * Indica se uma senha atende à política mínima de comprimento.
 *
 * @param password - Senha em claro.
 * @returns `true` se tem ao menos {@link MIN_PASSWORD_LENGTH} caracteres.
 */
export function isValidPassword(password: string): boolean {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH;
}

/**
 * Gera o hash scrypt de uma senha, com salt aleatório.
 *
 * @param password - Senha em claro.
 * @returns String `salt:derived` (hex) para armazenamento.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password, salt, KEY_LEN);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

/**
 * Verifica uma senha contra um hash `salt:derived`, em tempo constante.
 *
 * @param password - Senha em claro a verificar.
 * @param stored - Hash armazenado (`salt:derived`).
 * @returns `true` se a senha corresponde ao hash.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, derivedHex] = stored.split(":");
  if (!saltHex || !derivedHex) {
    return false;
  }
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(derivedHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
