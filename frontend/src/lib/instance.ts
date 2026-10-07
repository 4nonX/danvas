// The per-installation identity the server injects into every page
// (INSTANCE_NAME / INSTANCE_LOCALE, see backend httpapi/instance.go). The
// accent color needs no code here: it arrives as CSS token overrides.

export interface InstanceConfig {
  /** App name shown in the interface instead of "danvas". */
  name?: string;
  /** Interface language for users who have not chosen one. */
  locale?: string;
}

export function instanceConfig(): InstanceConfig {
  if (typeof window === "undefined") return {};
  return (window as unknown as { __HC_INSTANCE__?: InstanceConfig }).__HC_INSTANCE__ ?? {};
}

const PRODUCT = "danvas";

/** Interface text with the instance name instead of the product name. The
 *  licensor's notices ("© HyScaler. HyCanvas is a HyScaler product.") must stay
 *  unaltered under the Elastic License 2.0, so texts naming HyScaler are kept. */
export function withInstanceName(text: string): string {
  const name = instanceConfig().name;
  if (!name || !text.includes(PRODUCT) || text.includes("HyScaler")) return text;
  return text.split(PRODUCT).join(name);
}
