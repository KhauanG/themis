import { describe, expect, it } from 'vitest';
import { abrirSecao, hojeISO, proximaVersao } from './versionar.mjs';

describe('proximaVersao', () => {
  it('patch sobe a última casa', () => {
    expect(proximaVersao('2.6.2', 'patch')).toBe('2.6.3');
  });

  it('minor sobe a do meio e zera a última', () => {
    expect(proximaVersao('2.6.2', 'minor')).toBe('2.7.0');
  });

  it('major sobe a primeira e zera o resto', () => {
    expect(proximaVersao('2.6.2', 'major')).toBe('3.0.0');
  });

  it('aceita número pronto', () => {
    expect(proximaVersao('2.6.2', '4.1.9')).toBe('4.1.9');
  });

  it('recusa o que não entende, em vez de inventar', () => {
    expect(() => proximaVersao('2.6.2', 'maior')).toThrow(/major, minor, patch/);
    expect(() => proximaVersao('2.6.2', '2.7')).toThrow();
  });
});

describe('hojeISO', () => {
  /**
   * `toISOString()` cru usa UTC. No Brasil (UTC-3), das 21h em diante ele já devolve o dia
   * seguinte — e o changelog sairia datado de amanhã.
   */
  it('usa o dia local, não o UTC', () => {
    const noite = new Date('2026-08-06T23:30:00-03:00');
    expect(hojeISO(noite)).toBe('2026-08-06');
  });
});

const CABECALHO = `# Changelog

Texto de abertura.

---

## 2.6.2 — 2026-08-05

### Corrigido

- Alguma coisa.
`;

describe('abrirSecao', () => {
  it('insere a versão nova acima da anterior', () => {
    const { texto, jaExistia } = abrirSecao(CABECALHO, '2.7.0', '2026-08-06');
    expect(jaExistia).toBe(false);
    expect(texto).toContain('## 2.7.0 — 2026-08-06');
    expect(texto.indexOf('## 2.7.0')).toBeLessThan(texto.indexOf('## 2.6.2'));
  });

  it('preserva o cabeçalho e o conteúdo anterior', () => {
    const { texto } = abrirSecao(CABECALHO, '2.7.0', '2026-08-06');
    expect(texto.startsWith('# Changelog')).toBe(true);
    expect(texto).toContain('- Alguma coisa.');
  });

  // Rodar o script duas vezes não pode empilhar seções vazias da mesma versão.
  it('não duplica seção que já existe', () => {
    const uma = abrirSecao(CABECALHO, '2.7.0', '2026-08-06').texto;
    const { texto, jaExistia } = abrirSecao(uma, '2.7.0', '2026-08-06');
    expect(jaExistia).toBe(true);
    expect(texto).toBe(uma);
  });

  it('avisa em vez de escrever no lugar errado quando o formato muda', () => {
    expect(() => abrirSecao('# Só isso\n', '2.7.0', '2026-08-06')).toThrow(/formato do arquivo/);
  });
});
