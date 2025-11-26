/**
 * Remove acentos de uma string para comparação insensível a acentos
 * @param str - String a ser normalizada
 * @returns String sem acentos
 */
export function removeAccents(str: string): string {
   if (!str) return str;
   return str
      .normalize('NFD') // Decompõe caracteres acentuados
      .replace(/[\u0300-\u036f]/g, '') // Remove os acentos
      .toLowerCase(); // Converte para minúsculo para comparação case-insensitive
}








