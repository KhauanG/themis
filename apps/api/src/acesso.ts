// A conta de serviço ignora as Security Rules: este arquivo é a regra de firestore/firestore.rules para a API.

/** `users/{uid}` como veio do Firestore; `null` = sem documento de perfil. */
export type Perfil = Readonly<Record<string, unknown>> | null;

export function ehMaster(perfil: Perfil): boolean {
  return perfil?.['isMaster'] === true;
}

export function ehAdmin(perfil: Perfil): boolean {
  return perfil?.['isAdmin'] === true;
}

/** Mesma ordem dos `||` de `podeAcessarEstoque` em firestore.rules, sem converter tipo. */
export function podeAcessarEstoque(perfil: Perfil, inventoryId: string): boolean {
  if (ehMaster(perfil) || perfil === null) return true;
  const lista = perfil['allowedInventories'];
  return !Array.isArray(lista) || lista.length === 0 || lista.includes(inventoryId);
}

export function podeUsarErp(perfil: Perfil, inventoryId: string): boolean {
  return (ehAdmin(perfil) || ehMaster(perfil)) && podeAcessarEstoque(perfil, inventoryId);
}
