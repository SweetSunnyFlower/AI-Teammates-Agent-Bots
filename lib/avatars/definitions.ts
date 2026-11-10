import { validateAvatarDefinition, type AvatarDefinition } from "@bible-strong/avatar-core";
import { surfacePresets } from "@bible-strong/avatar-core/surfaces";
import type { BotAvatarConfig } from "@/lib/office/types";
import baseAvatar from "./base.avatar.json";

// Every bot shares the expressions and animations of the base avatar ("Strobi" from
// bible-strong-avatar-lab) and only swaps its body shape and color.

const cache = new Map<string, AvatarDefinition>();

const softenedRoundness: Partial<Record<BotAvatarConfig["shape"], number>> = {
  cube: 0.55,
  diamond: 0.25,
};

export function avatarDefinitionFor(config: BotAvatarConfig): AvatarDefinition {
  const key = `${config.shape}:${config.color}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const preset = { ...surfacePresets[config.shape] };
  const roundness = softenedRoundness[config.shape];
  if (roundness !== undefined) preset.roundness = roundness;

  const result = validateAvatarDefinition({
    ...baseAvatar,
    name: key,
    colors: { ...baseAvatar.colors, body: config.color },
    body: { primary: preset, nodes: [] },
  });
  if (!result.ok) {
    throw new Error(`Invalid avatar ${key}: ${result.errors[0]?.message}`);
  }
  cache.set(key, result.value as AvatarDefinition);
  return result.value as AvatarDefinition;
}
