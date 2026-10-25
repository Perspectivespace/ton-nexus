import { CityV2, useCityTier } from "./CityV2";

/**
 * Фоновый город «Ночного контура» (DESIGN.md п. 3.10–3.11): растёт вместе с реактором.
 * Чисто декоративный слой: aria-hidden, без событий, не влияет на логику экранов.
 */
export function CityBackdrop() {
  const tier = useCityTier();
  return (
    <div className="city" aria-hidden="true">
      <div className="c-stage">
        <CityV2 tier={tier} />
      </div>
      <div className="c-scrim" />
    </div>
  );
}
