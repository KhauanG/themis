/** `AAAA-MM-DD` do dia local de `agora` mais `diasAMais` dias de calendário. `toISOString()` cru daria UTC: depois das 21:00 em Brasília, o dia seguinte. */
export function hojeLocalISO(diasAMais = 0, agora = new Date()): string {
  const d = new Date(agora.getTime());
  d.setDate(d.getDate() + diasAMais);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
