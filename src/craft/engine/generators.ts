/**
 * The generator for a dimension. Kept apart from the generators themselves so
 * the Nether and End modules can import the overworld's types without the
 * overworld importing them back.
 */
import { EndGenerator } from "./end";
import { NetherGenerator } from "./nether";
import { isMapId, MapGenerator } from "./maps";
import { Generator, type ChunkGenerator, type GenSettings } from "./worldgen";

export function createGenerator(settings: GenSettings): ChunkGenerator {
  switch (settings.dimension ?? "overworld") {
    case "nether": return new NetherGenerator(settings.seed);
    case "end": return new EndGenerator(settings.seed);
    // A map pack is the overworld; the Nether and the End stay themselves, for a SkyBlock player who builds a portal.
    case "overworld": return isMapId(settings.map) ? new MapGenerator(settings.map, new Generator(settings)) : new Generator(settings);
    default: throw new Error(`no generator for the ${settings.dimension}`);
  }
}
