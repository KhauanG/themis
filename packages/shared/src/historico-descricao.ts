/**
 * Transforma os detalhes crus de uma entrada de histórico em texto legível.
 *
 * O histórico é trilha de auditoria: alguém vai abrir isto meses depois querendo saber
 * **o que exatamente mudou**. `de: 12 · para: 15` não responde; "Skol Lata — Quantidade
 * 12 → 15" responde.
 *
 * Função pura, sem DOM, com teste. A tela só desenha o que sai daqui.
 */
import type { AcaoHistorico } from './types.js';

export const ROTULO_ACAO: Record<AcaoHistorico, string> = {
  LOGIN: 'Entrou no sistema',
  MODIFICAR_PRODUTO: 'Contou produto',
  LIMPAR_CONTAGEM: 'Limpou a contagem',
  LIMPAR_ESTOQUE: 'Limpou o estoque',
  BUSCAR_ESTOQUE: 'Buscou o estoque no ERP',
  IMPORTAR_PLANILHA: 'Importou planilha',
  EXPORTAR_PLANILHA: 'Exportou relatório',
  ABRIR_AUDITORIA: 'Abriu a auditoria',
  CORRIGIR_ESTOQUE: 'Corrigiu o estoque',
  EXCLUIR_ESTOQUE: 'Excluiu estoque',
  FINALIZAR_CONTAGEM: 'Finalizou a contagem',
  CRIAR_PRODUTO: 'Cadastrou produto',
  EDITAR_PRODUTO: 'Editou produto',
  EXCLUIR_PRODUTO: 'Excluiu produto',
  CRIAR_ESTOQUE: 'Criou estoque',
  EDITAR_ESTOQUE: 'Editou estoque',
  CONFERIR_ITEM: 'Conferiu item',
  ALTERAR_PAPEL: 'Alterou papel de usuário',
  ALTERAR_CONFIGURACAO: 'Alterou configuração',
};

/** Cor da etiqueta. Destrutivo em vermelho, envio em âmbar, o resto neutro ou azul. */
export const COR_ACAO: Record<AcaoHistorico, string> = {
  LOGIN: '#5a6b7d',
  MODIFICAR_PRODUTO: '#0b2545',
  LIMPAR_CONTAGEM: '#b3261e',
  LIMPAR_ESTOQUE: '#b3261e',
  BUSCAR_ESTOQUE: '#0a7d55',
  IMPORTAR_PLANILHA: '#1b4d8c',
  EXPORTAR_PLANILHA: '#5a6b7d',
  ABRIR_AUDITORIA: '#5a6b7d',
  CORRIGIR_ESTOQUE: '#8a6100',
  EXCLUIR_ESTOQUE: '#b3261e',
  FINALIZAR_CONTAGEM: '#0a7d55',
  CRIAR_PRODUTO: '#1b4d8c',
  EDITAR_PRODUTO: '#1b4d8c',
  EXCLUIR_PRODUTO: '#b3261e',
  CRIAR_ESTOQUE: '#1b4d8c',
  EDITAR_ESTOQUE: '#1b4d8c',
  CONFERIR_ITEM: '#8a6100',
  ALTERAR_PAPEL: '#0b2545',
  ALTERAR_CONFIGURACAO: '#5a6b7d',
};

/** Uma alteração de valor. `de` ausente significa que o campo não existia antes. */
export interface Mudanca {
  campo: string;
  de: string;
  para: string;
}

export interface DescricaoEvento {
  /** Sobre o que a ação foi: nome do produto, do estoque, do usuário. */
  alvo?: string;
  /** Alterações no formato "de → para". */
  mudancas: Mudanca[];
  /** Frases soltas — totais, resultados, contexto. */
  fatos: string[];
}

type Detalhes = Record<string, unknown>;

const AUSENTE = '—';

function texto(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return AUSENTE;
  if (typeof valor === 'boolean') return valor ? 'sim' : 'não';
  return String(valor);
}

/** `YYYY-MM-DD` para `DD/MM/AAAA`, sem `new Date` — que desloca o fuso. */
function data(valor: unknown): string {
  const bruto = texto(valor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bruto)) return bruto;
  const [ano, mes, dia] = bruto.split('-');
  return `${dia}/${mes}/${ano}`;
}

function plural(n: number, singular: string, pluralPalavra: string): string {
  return `${n} ${n === 1 ? singular : pluralPalavra}`;
}

/** Só entra na lista se alguma das pontas existir e as duas forem diferentes. */
function mudanca(campo: string, de: unknown, para: unknown, formatar = texto): Mudanca | null {
  if (de === undefined && para === undefined) return null;
  const a = formatar(de);
  const b = formatar(para);
  if (a === b) return null;
  return { campo, de: a, para: b };
}

export function descreverEvento(acao: AcaoHistorico, detalhes: Detalhes = {}): DescricaoEvento {
  const d = detalhes;
  const mudancas: Mudanca[] = [];
  const fatos: string[] = [];
  const adicionar = (m: Mudanca | null) => {
    if (m) mudancas.push(m);
  };

  switch (acao) {
    case 'MODIFICAR_PRODUTO': {
      adicionar(mudanca('Quantidade', d['de'], d['para']));
      adicionar(mudanca('Validade', d['validadeDe'], d['validadePara'], data));
      if (d['ciclo'] !== undefined) fatos.push(`Ciclo ${texto(d['ciclo'])}`);
      return { alvo: d['produto'] ? String(d['produto']) : undefined, mudancas, fatos };
    }

    case 'EDITAR_PRODUTO': {
      adicionar(mudanca('Nome', d['nomeDe'], d['nomePara']));
      adicionar(mudanca('Código de barras', d['codigoDe'], d['codigoPara']));
      adicionar(mudanca('Estoque do sistema', d['sistemaDe'], d['sistemaPara']));
      adicionar(mudanca('Código no ERP', d['idErpDe'], d['idErpPara']));
      return { alvo: d['produto'] ? String(d['produto']) : undefined, mudancas, fatos };
    }

    case 'CRIAR_PRODUTO': {
      if (d['codigoBarras']) fatos.push(`Código ${texto(d['codigoBarras'])}`);
      if (d['estoqueSistema'] !== undefined) {
        fatos.push(`Estoque do sistema ${texto(d['estoqueSistema'])}`);
      }
      if (d['origem']) fatos.push(texto(d['origem']));
      return { alvo: d['produto'] ? String(d['produto']) : undefined, mudancas, fatos };
    }

    case 'EXCLUIR_PRODUTO': {
      if (d['tinhaContagem'] === true) fatos.push('O item já estava contado neste ciclo');
      return { alvo: d['produto'] ? String(d['produto']) : undefined, mudancas, fatos };
    }

    case 'CONFERIR_ITEM': {
      if (d['desfeito'] === true) {
        fatos.push('Conferência desfeita — o item voltou para a lista');
      } else {
        fatos.push(
          d['divergenciaConfirmada'] === true
            ? 'Divergência confirmada na conferência física'
            : 'Conferido como correto — a divergência não se confirmou',
        );
      }
      if (d['contado'] !== undefined && d['sistema'] !== undefined) {
        fatos.push(`Contado ${texto(d['contado'])} · sistema ${texto(d['sistema'])}`);
      }
      return { alvo: d['produto'] ? String(d['produto']) : undefined, mudancas, fatos };
    }

    case 'LIMPAR_CONTAGEM': {
      if (d['total'] !== undefined) {
        fatos.push(`${plural(Number(d['total']), 'produto zerado', 'produtos zerados')}`);
      }
      fatos.push('Quantidade, status e validade apagados');
      if (d['ciclo'] !== undefined) fatos.push(`Ciclo ${texto(d['ciclo'])}`);
      return { mudancas, fatos };
    }

    case 'IMPORTAR_PLANILHA': {
      if (d['criados'] !== undefined) {
        fatos.push(plural(Number(d['criados']), 'produto importado', 'produtos importados'));
      }
      if (Number(d['ignoradas']) > 0) {
        fatos.push(`${plural(Number(d['ignoradas']), 'linha ignorada', 'linhas ignoradas')}`);
      }
      return { alvo: d['arquivo'] ? String(d['arquivo']) : undefined, mudancas, fatos };
    }

    case 'BUSCAR_ESTOQUE': {
      if (d['recebidosDoErp'] !== undefined) {
        fatos.push(`${texto(d['recebidosDoErp'])} itens recebidos do ERP`);
      }
      if (d['atualizados'] !== undefined) {
        const n = Number(d['atualizados']);
        fatos.push(n === 0 ? 'Nenhum saldo mudou' : plural(n, 'saldo alterado', 'saldos alterados'));
      }
      if (Number(d['semCorrespondencia']) > 0) {
        fatos.push(`${texto(d['semCorrespondencia'])} produtos não existem no ERP`);
      }
      return { mudancas, fatos };
    }

    case 'CORRIGIR_ESTOQUE': {
      if (d['conferidos'] !== undefined) {
        fatos.push(plural(Number(d['conferidos']), 'item conferido', 'itens conferidos'));
      }
      if (d['divergentes'] !== undefined) {
        fatos.push(`${texto(d['divergentes'])} com divergência confirmada`);
      }
      if (d['enviadosAoErp'] !== undefined) {
        fatos.push(`${texto(d['enviadosAoErp'])} enviados ao ERP`);
      }
      if (d['confirmadosNoErp'] !== undefined) {
        fatos.push(`${texto(d['confirmadosNoErp'])} confirmados na releitura`);
      }
      if (Number(d['pendentesNoErp']) > 0) {
        fatos.push(`${texto(d['pendentesNoErp'])} não refletiram no ERP`);
      }
      if (Number(d['falhasNoEnvio']) > 0) {
        fatos.push(`${texto(d['falhasNoEnvio'])} recusados pelo ERP`);
      }
      if (d['ciclo'] !== undefined) fatos.push(`Ciclo ${texto(d['ciclo'])}`);
      return { mudancas, fatos };
    }

    case 'FINALIZAR_CONTAGEM': {
      if (d['ciclo'] !== undefined) fatos.push(`Ciclo ${texto(d['ciclo'])} fechado`);
      if (d['contados'] !== undefined) fatos.push(`${texto(d['contados'])} contados`);
      if (d['naoContados'] !== undefined) fatos.push(`${texto(d['naoContados'])} não contados`);
      if (d['incorretos'] !== undefined) fatos.push(`${texto(d['incorretos'])} divergentes`);
      return { mudancas, fatos };
    }

    case 'EXPORTAR_PLANILHA': {
      const tipos: Record<string, string> = {
        contagem: 'PDF da contagem',
        validade: 'PDF de validade',
        planilha: 'Planilha .xlsx',
      };
      if (d['tipo']) fatos.push(tipos[String(d['tipo'])] ?? texto(d['tipo']));
      if (d['itens'] !== undefined && d['de'] !== undefined) {
        fatos.push(`${texto(d['itens'])} de ${texto(d['de'])} itens`);
      }
      if (d['origem'] && d['origem'] !== 'ao-vivo') fatos.push('De uma auditoria salva');
      return { mudancas, fatos };
    }

    case 'CRIAR_ESTOQUE': {
      if (d['descricao']) fatos.push(texto(d['descricao']));
      if (d['comHash'] === true) fatos.push('Com HashLoja configurado');
      return { alvo: d['estoque'] ? String(d['estoque']) : undefined, mudancas, fatos };
    }

    case 'EDITAR_ESTOQUE': {
      adicionar(mudanca('Nome', d['nomeDe'], d['nomePara']));
      adicionar(mudanca('Descrição', d['descricaoDe'], d['descricaoPara']));
      if (d['hashAlterado'] === true) fatos.push('HashLoja alterado');
      return { alvo: d['estoque'] ? String(d['estoque']) : undefined, mudancas, fatos };
    }

    case 'EXCLUIR_ESTOQUE': {
      if (d['produtos'] !== undefined) {
        fatos.push(`${plural(Number(d['produtos']), 'produto apagado', 'produtos apagados')}`);
      }
      return { alvo: d['estoque'] ? String(d['estoque']) : undefined, mudancas, fatos };
    }

    case 'ALTERAR_PAPEL': {
      adicionar(mudanca('Papel', d['papelDe'], d['papelPara']));
      return { alvo: d['usuario'] ? String(d['usuario']) : undefined, mudancas, fatos };
    }

    case 'ALTERAR_CONFIGURACAO': {
      adicionar(mudanca('Modo contagem', d['modoContagemDe'], d['modoContagemPara']));
      if (d['estoqueTravado']) fatos.push(`Travou: ${texto(d['estoqueTravado'])}`);
      if (d['estoqueLiberado']) fatos.push(`Liberou: ${texto(d['estoqueLiberado'])}`);
      return { mudancas, fatos };
    }

    case 'LOGIN':
      return { mudancas, fatos };

    default: {
      // Ação sem formatação própria (ou gravada pelo 1.x com outro formato): mostra os
      // pares crus em vez de esconder. Registro parcial é melhor que registro nenhum.
      for (const [chave, valor] of Object.entries(d)) {
        if (valor === null || valor === undefined || typeof valor === 'object') continue;
        fatos.push(`${chave}: ${texto(valor)}`);
      }
      return { mudancas, fatos };
    }
  }
}
