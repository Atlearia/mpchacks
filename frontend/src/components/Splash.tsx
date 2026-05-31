interface SplashProps {
  message: string;
  error?: boolean;
}

export default function Splash({ message, error }: SplashProps) {
  return (
    <div className={`splash${error ? " splash--error" : ""}`}>
      <div className="splash-inner">
        <div className="splash-logo-wrap">
          <div className="splash-logo-glow" aria-hidden />
          <img src="/crest-logo.png" alt="" className="splash-logo" draggable={false} />
        </div>

        <div className="splash-brand">
          <span className="splash-title">Crest</span>
          <span className="splash-sub">Expense Intelligence</span>
        </div>

        {!error && (
          <div className="splash-bars" aria-hidden>
            <span />
            <span />
            <span />
          </div>
        )}

        <p className={`splash-message${error ? " splash-message--error" : ""}`}>{message}</p>
      </div>
    </div>
  );
}
