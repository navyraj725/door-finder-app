export default function ScamWarning() {
  return (
    <div className="scam-alert" role="img" aria-label="Scam warning: report suspicious accounts">
      <span className="scam-alert-ring" aria-hidden="true"></span>
      <span className="scam-alert-ring scam-alert-ring--late" aria-hidden="true"></span>
      <div className="scam-alert-shake" aria-hidden="true">
        <svg className="scam-alert-svg" viewBox="0 0 220 200" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            className="scam-alert-triangle"
            d="M110 16 L204 180 L16 180 Z"
            stroke="#E80000"
            strokeWidth="15"
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="rgba(232,0,0,0.04)"
          />
        </svg>
        <div className="scam-alert-flash">
          <svg className="scam-alert-svg scam-alert-svg--overlay" viewBox="0 0 220 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <g className="scam-alert-excl">
              <rect x="101" y="50" width="18" height="56" rx="9" fill="#E80000" />
              <circle cx="110" cy="124" r="11" fill="#E80000" />
            </g>
            <text
              className="scam-alert-text"
              x="110"
              y="167"
              textAnchor="middle"
              fill="#E80000"
              fontFamily="'Poppins', 'Arial Black', Arial, sans-serif"
              fontSize="38"
              fontWeight="900"
              letterSpacing="1"
            >
              SCAM
            </text>
          </svg>
        </div>
      </div>
    </div>
  );
}