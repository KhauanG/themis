import { useEffect, useRef, useState } from 'react';

interface Props {
  onLer: (codigo: string) => void;
  onFechar: () => void;
}

/** Formatos usados em produto de mercearia e bebida. */
const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];

/** Intervalo entre varreduras. Abaixo disso a CPU do celular esquenta sem ganho real. */
const INTERVALO_MS = 250;

export function LeitorCodigo({ onLer, onFechar }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [erro, setErro] = useState('');
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    // Guarda contra dupla entrega: a varredura roda em intervalo e o mesmo código
    // apareceria em vários quadros seguidos.
    let encerrado = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;

    async function iniciar() {
      if (!window.BarcodeDetector) {
        setErro('Este navegador não lê código de barras. Use o Chrome no Android.');
        return;
      }
      // getUserMedia exige contexto seguro. Em produção o site é HTTPS; em rede local
      // sem certificado a câmera simplesmente não abre.
      if (!window.isSecureContext) {
        setErro('A câmera só funciona em conexão segura (HTTPS).');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (encerrado) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const el = video.current;
        if (!el) return;
        el.srcObject = stream;
        await el.play();
        setPronto(true);

        const detector = new window.BarcodeDetector({ formats: FORMATOS });

        timer = setInterval(async () => {
          if (encerrado || !video.current) return;
          try {
            const achados = await detector.detect(video.current);
            const codigo = achados[0]?.rawValue?.trim();
            if (codigo) {
              encerrado = true;
              navigator.vibrate?.(60);
              onLer(codigo);
            }
          } catch {
            // Quadro ruim (foco, movimento). Próximo ciclo tenta de novo.
          }
        }, INTERVALO_MS);
      } catch (erroCamera) {
        const nome = (erroCamera as { name?: string } | null)?.name;
        setErro(
          nome === 'NotAllowedError'
            ? 'Permissão de câmera negada. Libere nas configurações do navegador.'
            : 'Não foi possível abrir a câmera.',
        );
      }
    }

    void iniciar();

    return () => {
      encerrado = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onLer]);

  return (
    <div className="leitor" role="dialog" aria-modal="true" aria-label="Ler código de barras">
      <video ref={video} className="leitor__video" playsInline muted />
      <div className="leitor__mira" aria-hidden="true" />

      <div className="leitor__rodape">
        {erro ? (
          <p className="leitor__erro" role="alert">
            {erro}
          </p>
        ) : (
          <p className="leitor__dica">{pronto ? 'Aponte para o código de barras' : 'Abrindo câmera...'}</p>
        )}
        <button className="botao botao--secundario botao--largo" type="button" onClick={onFechar}>
          Fechar
        </button>
      </div>
    </div>
  );
}
