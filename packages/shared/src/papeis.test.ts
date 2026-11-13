import { describe, expect, it } from 'vitest';
import { flagsDoPapel, papelDe, permissoesDe } from './papeis.js';

describe('papelDe', () => {
  it('sem perfil ou sem flag é usuário comum', () => {
    expect(papelDe(null)).toBe('comum');
    expect(papelDe({})).toBe('comum');
    expect(papelDe({ isAdmin: false, isAuditor: false, isMaster: false })).toBe('comum');
  });

  it('master vence admin e auditor', () => {
    expect(papelDe({ isMaster: true, isAdmin: true, isAuditor: true })).toBe('master');
  });

  it('admin vence auditor', () => {
    expect(papelDe({ isAdmin: true, isAuditor: true })).toBe('admin');
  });

  // Perfis antigos foram gravados com tipos diferentes; o 1.x tolerava todos.
  it('aceita flag legada gravada como string ou número', () => {
    expect(papelDe({ isAuditor: 'true' } as never)).toBe('auditor');
    expect(papelDe({ isAuditor: 'TRUE' } as never)).toBe('auditor');
    expect(papelDe({ isAdmin: 1 } as never)).toBe('admin');
  });

  it('não liga a flag com string arbitrária', () => {
    expect(papelDe({ isAuditor: 'sim' } as never)).toBe('comum');
    expect(papelDe({ isAuditor: 0 } as never)).toBe('comum');
  });
});

describe('permissoesDe', () => {
  it('usuário comum conta e finaliza, mas não gerencia', () => {
    const p = permissoesDe('comum');
    expect(p.contar).toBe(true);
    expect(p.finalizarContagem).toBe(true);
    expect(p.gerenciarProdutos).toBe(false);
    expect(p.corrigirContagem).toBe(false);
    expect(p.verAuditoria).toBe(false);
  });

  it('auditor lê auditoria mas não corrige contagem', () => {
    const p = permissoesDe('auditor');
    expect(p.verAuditoria).toBe(true);
    expect(p.corrigirContagem).toBe(false);
    expect(p.gerenciarEstoque).toBe(false);
  });

  /**
   * A regra de `historico_geral` é `allow read: if signedIn() && isMaster()`. Enquanto
   * `permissoesDe` dizia `admin || auditor`, os dois viam o item no menu, abriam a tela e
   * levavam `permission-denied`. Interface mais permissiva que a regra é promessa que o
   * banco não cumpre.
   */
  it('só master lê o histórico — é o que a regra permite', () => {
    expect(permissoesDe('master').verHistorico).toBe(true);
    expect(permissoesDe('admin').verHistorico).toBe(false);
    expect(permissoesDe('auditor').verHistorico).toBe(false);
    expect(permissoesDe('comum').verHistorico).toBe(false);
  });

  it('admin corrige e gerencia estoque, mas não mexe em usuários', () => {
    const p = permissoesDe('admin');
    expect(p.corrigirContagem).toBe(true);
    expect(p.gerenciarEstoque).toBe(true);
    expect(p.gerenciarUsuarios).toBe(false);
  });

  it('só master gerencia usuários', () => {
    expect(permissoesDe('master').gerenciarUsuarios).toBe(true);
  });
});

describe('flagsDoPapel', () => {
  it('os quatro papéis', () => {
    expect(flagsDoPapel('comum')).toEqual({ isAdmin: false, isAuditor: false, isMaster: false });
    expect(flagsDoPapel('auditor')).toEqual({ isAdmin: false, isAuditor: true, isMaster: false });
    expect(flagsDoPapel('admin')).toEqual({ isAdmin: true, isAuditor: false, isMaster: false });
    // Master leva as duas: quem lê só isAdmin (o app antigo, a API) não o trata como comum.
    expect(flagsDoPapel('master')).toEqual({ isAdmin: true, isAuditor: false, isMaster: true });
  });
  it('ida e volta com papelDe', () => {
    for (const p of ['comum', 'auditor', 'admin', 'master'] as const) expect(papelDe(flagsDoPapel(p))).toBe(p);
  });
});
