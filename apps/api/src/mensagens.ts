// O site mostra `corpo.erro` como vem: as cinco da spec 4.3 e a do hash repetido (4.5) são cópia exata.
export const MENSAGENS = {
  sessao: 'Sua sessão expirou. Entre de novo.',
  permissao: 'Você não tem permissão para usar o ERP nesta loja.',
  soMaster: 'Só o master pode trocar ou testar outro HashLoja.',
  lojaSemHash: 'Esta loja não tem HashLoja configurado.',
  recarregue: 'O Themis foi atualizado. Recarregue a página.',
  semCredencial: 'O servidor não está configurado para falar com o ERP. Avise o administrador.',
  hashRepetido: 'Este hash já está configurado em outra loja.',
  hashInvalido: 'HashLoja inválido: cole só o código, sem espaços no meio.',
  falhaFirestore: 'Não foi possível conferir a configuração agora. Tente de novo em instantes.',
} as const;
