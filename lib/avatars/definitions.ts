import { validateAvatarDefinition, type AvatarDefinition } from "@bible-strong/avatar-core";
import { surfacePresets } from "@bible-strong/avatar-core/surfaces";
import type { BotAvatarConfig } from "@/lib/office/types";
import baseAvatar from "./base.avatar.json";
import freddyAvatar from "./freddy.avatar.json";

// Every bot shares the expressions and animations of the base avatar ("Strobi" from
// bible-strong-avatar-lab) and only swaps its body shape and color. The Head bot is the
// exception: it wears "Freddy", body and all, in its own chosen color.

/** Which stock avatar a bot wears. */
export type AvatarVariant = "base" | "head";

const cache = new Map<string, AvatarDefinition>();

const softenedRoundness: Partial<Record<BotAvatarConfig["shape"], number>> = {
  cube: 0.55,
  diamond: 0.25,
};

/**
 * Avatar Lab now exports roundness above 1 for a stretched surface; this schema caps it at 1, so a
 * freshly exported character would be rejected.
 */
function clampBody(body: typeof freddyAvatar.body) {
  const round = (v: number) => Math.min(Math.max(v, 0), 1);
  return {
    primary: { ...body.primary, roundness: round(body.primary.roundness) },
    nodes: body.nodes.map((n) => ({ ...n, surface: { ...n.surface, roundness: round(n.surface.roundness) } })),
  };
}

export function avatarDefinitionFor(config: BotAvatarConfig, variant: AvatarVariant = "base"): AvatarDefinition {
  const key = `${variant}:${config.shape}:${config.color}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const preset = { ...surfacePresets[config.shape] };
  const roundness = softenedRoundness[config.shape];
  if (roundness !== undefined) preset.roundness = roundness;

  const source = variant === "head" ? freddyAvatar : baseAvatar;
  const result = validateAvatarDefinition({
    ...source,
    name: key,
    colors: { ...source.colors, body: config.color },
    // Freddy's body (ears and all) is the point of it; other bots get their chosen shape.
    body: variant === "head" ? clampBody(source.body) : { primary: preset, nodes: [] },
  });
  // A bad definition must never take the office and the panels down with it: every panel draws
  // avatars, so a throw here hits every error boundary at once. Fall back to the base avatar.
  if (!result.ok) {
    if (variant !== "base") {
      console.error(`Avatar "${variant}" is invalid (${result.errors[0]?.path}: ${result.errors[0]?.message}) — using the base avatar.`);
      return avatarDefinitionFor(config, "base");
    }
    throw new Error(`Invalid avatar ${key}: ${result.errors[0]?.message}`);
  }
  cache.set(key, result.value as AvatarDefinition);
  return result.value as AvatarDefinition;
}
