import { PLATFORM } from "../brand.js";

export default function PoweredBy() {
  return (
    <p className="powered-by">
      Powered by{" "}
      <span className="powered-by-name">
        <span aria-hidden="true">{PLATFORM.mark}</span> {PLATFORM.name}
      </span>
    </p>
  );
}
