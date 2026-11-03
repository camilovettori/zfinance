# Auditoria financeira — 3 de novembro de 2026

## O que os valores da imagem representam

- Semana de 14 a 20 de dezembro: €7.935,11 + €570,70 − €568,38 = **€7.937,43**.
- Ciclo de 7 de dezembro a 3 de janeiro: €8.550,63 + €5.165,80 − €4.461,51 = **€9.254,92**.

As duas equações fecham, mas os períodos são diferentes. O ciclo não é o mês de dezembro. Essa apresentação foi removida do Planner.

## Apresentação atual

O Planner mostra uma semana por vez, com um cabeçalho único e Print. O resumo inferior mostra saldo disponível na data atual, saldo previsto no último dia do mês selecionado e saldo previsto em 31 de dezembro do ano selecionado. Não inclui dias adjacentes do mês seguinte nesses dois fechamentos.

## Correções verificadas

- Abertura do plano reconstruída com as mesmas linhas que o Planner soma, conciliando o dia atual com o saldo registrado e evitando descontar novamente pendências antigas.
- Data de referência das previsões mantida no dia atual ao navegar para meses futuros.
- Recorrências mensais ancoradas no dia original: 31/jan → 28/fev → 31/mar.
- Respeito à data de encerramento de recorrências.
- Salário mensal de Camilo de €2.883 no dia 25; apenas sábado/domingo antecipam para sexta.
- Projeção considera ocorrências recorrentes futuras e lançamentos avulsos pendentes; não acrescenta médias de gastos ocultas.
- Filtros de período respeitados nos totais por categoria; despesas divididas não são contadas integralmente e novamente nas divisões.
- Orçamentos por categoria usam as parcelas efetivamente atribuídas à categoria.
- Poupança já transferida não é novamente descontada como uma meta ainda pendente; transferências entre contas de poupança não contam como novos aportes.
- Duplicação confirmada pelo usuário: manter Remarkable Iris de €3,99 no dia 17 e desativar a regra do dia 18, sem apagar histórico.

## Conferência dos dados sincronizados

Foi lida uma cópia de um household com uma conta, 133 transações e 38 regras. A conta da nuvem foi recalculada também por SQL independente: o saldo salvo e o saldo calculado eram ambos €528,96. Não havia transações futuras marcadas como concluídas nessa cópia.

Essa cópia da nuvem ainda tinha o salário semanal antigo e o saldo anterior, portanto estava desatualizada em relação às alterações solicitadas no app local. Nenhuma alteração foi feita diretamente no banco durante a auditoria. A cópia privada e seus resultados ficaram na pasta temporária do usuário, fora do repositório.

Aplicando em memória as alterações autorizadas — saldo atual de €8.121,94, salário mensal de €2.883, semana de segunda a domingo e remoção da cobrança mensal duplicada — a cópia produziu:

| Referência | Saldo |
| --- | ---: |
| Atual, 03/11/2026 | €8.121,94 |
| Previsto em 30/11/2026 | €9.112,62 |
| Previsto em 31/12/2026 | €9.775,90 |

São previsões sobre essa cópia com as alterações aplicadas. Dados locais mais recentes, movimentações adicionais ou regras diferentes mudam os resultados. Não houve consulta a extrato bancário externo; o saldo atual de referência foi informado pelo usuário.

## Validação

- Equações de dia, semana e ciclo e continuidade entre ciclos testadas em doze meses, incluindo a virada de ano.
- Testes de fechamentos exatos de mês/ano e de poupança parcialmente financiada.
- Suíte automatizada, checagem de tipos, lint, build PWA e seis testes de navegador.
- Auditoria adicional sobre a cópia privada, acionada com `HOMECOIN_AUDIT_SNAPSHOT`, sem embutir dados financeiros nos testes do repositório.

Para repetir a auditoria de uma cópia privada compatível:

```powershell
$env:HOMECOIN_AUDIT_SNAPSHOT = 'C:\caminho\snapshot.json'
pnpm exec vitest run src/tests/snapshot-audit.test.ts
```

A sincronização entre local e live continua sendo uma pendência separada: a leitura confirmou que a nuvem ainda não continha as alterações locais solicitadas.
