export function Brand() {
  return (
    <div className="brand" aria-label="Likerts home">
      <span className="brand-mark" aria-hidden="true">
        {[11, 18, 27, 20, 13].map((height, index) => <i key={index} style={{ height }} />)}
      </span>
      <span>Likerts</span>
    </div>
  );
}
