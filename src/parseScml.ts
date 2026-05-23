import { promises as fs } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import type { Transform } from "./transform";
import { normalizeTransform } from "./transform";

type XmlNode = Record<string, unknown>;

export interface ScmlFile {
  sourcePath: string;
  folders: Folder[];
  fileMap: Map<string, FolderFile>;
  entities: Entity[];
}

export interface Folder {
  id: number;
  files: FolderFile[];
}

export interface FolderFile {
  folderId: number;
  id: number;
  name: string;
  width: number;
  height: number;
  pivotX: number;
  pivotY: number;
}

export interface Entity {
  id: number;
  name: string;
  animations: Animation[];
}

export interface AnimationBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Animation {
  id: number;
  name: string;
  length: number;
  interval?: number;
  looping: boolean;
  bounds?: AnimationBounds;
  mainlineKeys: MainlineKey[];
  timelines: Timeline[];
}

export interface MainlineKey {
  id: number;
  time: number;
  boneRefs: BoneRef[];
  objectRefs: ObjectRef[];
}

export interface BoneRef {
  id: number;
  parent?: number;
  timeline: number;
  key: number;
}

export interface ObjectRef {
  id: number;
  parent?: number;
  timeline: number;
  key: number;
  zIndex: number;
}

export interface Timeline {
  id: number;
  name: string;
  objectType: "bone" | "sprite";
  keys: TimelineKey[];
}

export interface TimelineKey {
  id: number;
  time: number;
  spin: number;
  objectType: "bone" | "sprite";
  transform: Transform;
  folderId?: number;
  fileId?: number;
  pivotX?: number;
  pivotY?: number;
}

export function folderFileKey(folderId: number, fileId: number): string {
  return `${folderId}:${fileId}`;
}

export async function parseScml(scmlPath: string): Promise<ScmlFile> {
  const xml = await fs.readFile(scmlPath, "utf8");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: true,
    trimValues: true,
  });
  const parsed = parser.parse(xml) as XmlNode;
  const root = getNode(parsed, "spriter_data", "SCML root");

  assertNoUnsupportedTags(root);

  const folders = asArray(getOptional(root, "folder")).map(parseFolder);
  const fileMap = new Map<string, FolderFile>();

  for (const folder of folders) {
    for (const file of folder.files) {
      fileMap.set(folderFileKey(file.folderId, file.id), file);
    }
  }

  const entities = asArray(getOptional(root, "entity")).map(parseEntity);

  if (folders.length === 0) {
    throw new Error("SCML does not contain any <folder> definitions.");
  }

  if (entities.length === 0) {
    throw new Error("SCML does not contain any <entity> definitions.");
  }

  return {
    sourcePath: scmlPath,
    folders,
    fileMap,
    entities,
  };
}

export function listAnimationNames(scml: ScmlFile): string[] {
  return scml.entities.flatMap((entity) =>
    entity.animations.map((animation) => animation.name),
  );
}

function parseFolder(rawValue: unknown): Folder {
  const raw = asNode(rawValue, "folder");
  const id = numberAttr(raw, "id", "folder");
  const files = asArray(getOptional(raw, "file")).map((file) =>
    parseFolderFile(file, id),
  );

  if (files.length === 0) {
    throw new Error(`Folder ${id} does not contain any <file> entries.`);
  }

  return { id, files };
}

function parseFolderFile(rawValue: unknown, folderId: number): FolderFile {
  const raw = asNode(rawValue, `folder ${folderId} file`);
  const id = numberAttr(raw, "id", `folder ${folderId} file`);
  const name = stringAttr(raw, "name", `folder ${folderId} file ${id}`);

  return {
    folderId,
    id,
    name,
    width: numberAttr(raw, "width", `folder ${folderId} file ${id}`),
    height: numberAttr(raw, "height", `folder ${folderId} file ${id}`),
    pivotX: numberAttr(raw, "pivot_x", `folder ${folderId} file ${id}`, 0),
    pivotY: numberAttr(raw, "pivot_y", `folder ${folderId} file ${id}`, 1),
  };
}

function parseEntity(rawValue: unknown): Entity {
  const raw = asNode(rawValue, "entity");
  const id = numberAttr(raw, "id", "entity");
  const name = stringAttr(raw, "name", `entity ${id}`, `Entity ${id}`);
  const animations = asArray(getOptional(raw, "animation")).map((animation) =>
    parseAnimation(animation, name),
  );

  return { id, name, animations };
}

function parseAnimation(rawValue: unknown, entityName: string): Animation {
  const raw = asNode(rawValue, `animation in ${entityName}`);
  const id = numberAttr(raw, "id", `animation in ${entityName}`);
  const name = stringAttr(raw, "name", `animation ${id}`, `Animation ${id}`);
  const length = numberAttr(raw, "length", `animation ${name}`);
  const interval = optionalNumberAttr(raw, "interval", `animation ${name}`);
  const looping = booleanAttr(raw, "looping", true);
  const mainline = getNode(raw, "mainline", `animation ${name}`);
  const mainlineKeys = asArray(getOptional(mainline, "key"))
    .map((key) => parseMainlineKey(key, name))
    .sort((a, b) => a.time - b.time);
  const timelines = asArray(getOptional(raw, "timeline"))
    .map((timeline) => parseTimeline(timeline, name))
    .sort((a, b) => a.id - b.id);

  if (mainlineKeys.length === 0) {
    throw new Error(`Animation "${name}" does not contain any mainline keys.`);
  }

  if (timelines.length === 0) {
    throw new Error(`Animation "${name}" does not contain any timelines.`);
  }

  return {
    id,
    name,
    length,
    interval,
    looping,
    bounds: parseAnimationBounds(raw),
    mainlineKeys,
    timelines,
  };
}

function parseAnimationBounds(raw: XmlNode): AnimationBounds | undefined {
  const left = optionalNumberAttr(raw, "l", "animation bounds");
  const top = optionalNumberAttr(raw, "t", "animation bounds");
  const right = optionalNumberAttr(raw, "r", "animation bounds");
  const bottom = optionalNumberAttr(raw, "b", "animation bounds");

  if ([left, top, right, bottom].every((value) => value === undefined)) {
    return undefined;
  }

  if ([left, top, right, bottom].some((value) => value === undefined)) {
    throw new Error(
      "Animation bounds must include all of l, t, r, and b when any bound is present.",
    );
  }

  const width = right! - left!;
  const height = bottom! - top!;

  if (width <= 0 || height <= 0) {
    throw new Error(
      `Animation bounds are invalid: l=${left}, t=${top}, r=${right}, b=${bottom}.`,
    );
  }

  return {
    left: left!,
    top: top!,
    right: right!,
    bottom: bottom!,
    width,
    height,
  };
}

function parseMainlineKey(
  rawValue: unknown,
  animationName: string,
): MainlineKey {
  const raw = asNode(rawValue, `mainline key in ${animationName}`);
  const id = numberAttr(raw, "id", `mainline key in ${animationName}`);

  return {
    id,
    time: numberAttr(raw, "time", `mainline key ${id} in ${animationName}`, 0),
    boneRefs: asArray(getOptional(raw, "bone_ref")).map((boneRef) =>
      parseBoneRef(boneRef, animationName),
    ),
    objectRefs: asArray(getOptional(raw, "object_ref")).map((objectRef) =>
      parseObjectRef(objectRef, animationName),
    ),
  };
}

function parseBoneRef(rawValue: unknown, animationName: string): BoneRef {
  const raw = asNode(rawValue, `bone_ref in ${animationName}`);
  const id = numberAttr(raw, "id", `bone_ref in ${animationName}`);
  const parent = optionalNumberAttr(
    raw,
    "parent",
    `bone_ref ${id} in ${animationName}`,
  );

  return {
    id,
    parent,
    timeline: numberAttr(raw, "timeline", `bone_ref ${id} in ${animationName}`),
    key: numberAttr(raw, "key", `bone_ref ${id} in ${animationName}`),
  };
}

function parseObjectRef(rawValue: unknown, animationName: string): ObjectRef {
  const raw = asNode(rawValue, `object_ref in ${animationName}`);
  const id = numberAttr(raw, "id", `object_ref in ${animationName}`);
  const parent = optionalNumberAttr(
    raw,
    "parent",
    `object_ref ${id} in ${animationName}`,
  );

  return {
    id,
    parent,
    timeline: numberAttr(
      raw,
      "timeline",
      `object_ref ${id} in ${animationName}`,
    ),
    key: numberAttr(raw, "key", `object_ref ${id} in ${animationName}`),
    zIndex: numberAttr(
      raw,
      "z_index",
      `object_ref ${id} in ${animationName}`,
      id,
    ),
  };
}

function parseTimeline(rawValue: unknown, animationName: string): Timeline {
  const raw = asNode(rawValue, `timeline in ${animationName}`);
  const id = numberAttr(raw, "id", `timeline in ${animationName}`);
  const name = stringAttr(
    raw,
    "name",
    `timeline ${id} in ${animationName}`,
    `Timeline ${id}`,
  );
  const declaredObjectType = optionalStringAttr(raw, "object_type");

  if (
    declaredObjectType !== undefined &&
    declaredObjectType !== "bone" &&
    declaredObjectType !== "sprite"
  ) {
    throw new Error(
      `Unsupported Spriter object_type "${declaredObjectType}" in animation "${animationName}", timeline "${name}". Only bones and sprite objects are supported.`,
    );
  }

  const keys = asArray(getOptional(raw, "key"))
    .map((key) =>
      parseTimelineKey(key, animationName, name, declaredObjectType),
    )
    .sort((a, b) => a.time - b.time);

  if (keys.length === 0) {
    throw new Error(
      `Timeline "${name}" in animation "${animationName}" does not contain any keys.`,
    );
  }

  const inferredTypes = new Set(keys.map((key) => key.objectType));

  if (inferredTypes.size !== 1) {
    throw new Error(
      `Timeline "${name}" in animation "${animationName}" mixes bone and sprite keys, which is unsupported.`,
    );
  }

  return {
    id,
    name,
    objectType: keys[0].objectType,
    keys,
  };
}

function parseTimelineKey(
  rawValue: unknown,
  animationName: string,
  timelineName: string,
  declaredObjectType?: string,
): TimelineKey {
  const raw = asNode(
    rawValue,
    `timeline key in ${animationName}/${timelineName}`,
  );
  const id = numberAttr(
    raw,
    "id",
    `timeline key in ${animationName}/${timelineName}`,
  );
  const curveType = optionalStringAttr(raw, "curve_type");

  if (curveType !== undefined && curveType !== "linear") {
    throw new Error(
      `Unsupported curve_type "${curveType}" in animation "${animationName}", timeline "${timelineName}", key ${id}. Only linear interpolation is supported.`,
    );
  }

  const boneNodes = asArray(getOptional(raw, "bone"));
  const objectNodes = asArray(getOptional(raw, "object"));

  if (boneNodes.length + objectNodes.length !== 1) {
    throw new Error(
      `Timeline key ${id} in animation "${animationName}", timeline "${timelineName}" must contain exactly one <bone> or <object>.`,
    );
  }

  const common = {
    id,
    time: numberAttr(
      raw,
      "time",
      `timeline key ${id} in ${animationName}/${timelineName}`,
      0,
    ),
    spin: numberAttr(
      raw,
      "spin",
      `timeline key ${id} in ${animationName}/${timelineName}`,
      1,
    ),
  };

  if (boneNodes.length === 1) {
    if (declaredObjectType !== undefined && declaredObjectType !== "bone") {
      throw new Error(
        `Timeline "${timelineName}" in animation "${animationName}" declares ${declaredObjectType} but contains a bone key.`,
      );
    }

    const bone = asNode(
      boneNodes[0],
      `bone key ${id} in ${animationName}/${timelineName}`,
    );

    return {
      ...common,
      objectType: "bone",
      transform: parseTransform(bone),
    };
  }

  if (declaredObjectType !== undefined && declaredObjectType !== "sprite") {
    throw new Error(
      `Timeline "${timelineName}" in animation "${animationName}" declares ${declaredObjectType} but contains a sprite object key.`,
    );
  }

  const object = asNode(
    objectNodes[0],
    `object key ${id} in ${animationName}/${timelineName}`,
  );
  const objectType = optionalStringAttr(object, "type") ?? "sprite";

  if (objectType !== "sprite") {
    throw new Error(
      `Unsupported object type "${objectType}" in animation "${animationName}", timeline "${timelineName}", key ${id}. Only sprite objects are supported.`,
    );
  }

  return {
    ...common,
    objectType: "sprite",
    transform: parseTransform(object),
    folderId: numberAttr(
      object,
      "folder",
      `object key ${id} in ${animationName}/${timelineName}`,
    ),
    fileId: numberAttr(
      object,
      "file",
      `object key ${id} in ${animationName}/${timelineName}`,
    ),
    pivotX: optionalNumberAttr(
      object,
      "pivot_x",
      `object key ${id} in ${animationName}/${timelineName}`,
    ),
    pivotY: optionalNumberAttr(
      object,
      "pivot_y",
      `object key ${id} in ${animationName}/${timelineName}`,
    ),
  };
}

function parseTransform(raw: XmlNode): Transform {
  const alpha =
    optionalNumberAttr(raw, "alpha", "transform") ??
    optionalNumberAttr(raw, "a", "transform") ??
    1;

  return normalizeTransform({
    x: numberAttr(raw, "x", "transform", 0),
    y: numberAttr(raw, "y", "transform", 0),
    angle: numberAttr(raw, "angle", "transform", 0),
    scaleX: numberAttr(raw, "scale_x", "transform", 1),
    scaleY: numberAttr(raw, "scale_y", "transform", 1),
    alpha,
  });
}

function assertNoUnsupportedTags(root: unknown): void {
  const unsupportedTags = new Map<string, string>([
    ["character_map", "character maps"],
    ["map_instruction", "character maps"],
    ["soundline", "sounds"],
    ["eventline", "events"],
    ["varline", "variables"],
    ["variable", "variables"],
    ["tagline", "tags"],
    ["meta", "metadata/events/variables"],
    ["ik", "IK"],
    ["ik_object", "IK"],
    ["box", "box objects"],
    ["point", "point objects"],
    ["skin", "mesh deformation"],
    ["deform", "mesh deformation"],
  ]);

  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    if (!isObject(value)) {
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      const feature = unsupportedTags.get(key);

      if (feature !== undefined) {
        throw new Error(
          `Unsupported Spriter feature at ${path}/${key}: ${feature} are not supported by this renderer.`,
        );
      }

      visit(child, `${path}/${key}`);
    }
  };

  visit(root, "spriter_data");
}

function asArray(value: unknown): unknown[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function getNode(raw: XmlNode, key: string, context: string): XmlNode {
  return asNode(getOptional(raw, key), `${context}/${key}`);
}

function getOptional(raw: XmlNode, key: string): unknown {
  return raw[key];
}

function asNode(value: unknown, context: string): XmlNode {
  if (!isObject(value) || Array.isArray(value)) {
    throw new Error(`Expected ${context} to be an XML object.`);
  }

  return value;
}

function isObject(value: unknown): value is XmlNode {
  return typeof value === "object" && value !== null;
}

function numberAttr(
  raw: XmlNode,
  key: string,
  context: string,
  defaultValue?: number,
): number {
  const value = raw[key];

  if (value === undefined || value === "") {
    if (defaultValue !== undefined) {
      return defaultValue;
    }

    throw new Error(`Missing numeric attribute "${key}" on ${context}.`);
  }

  const numberValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numberValue)) {
    throw new Error(
      `Invalid numeric attribute "${key}" on ${context}: ${String(value)}.`,
    );
  }

  return numberValue;
}

function optionalNumberAttr(
  raw: XmlNode,
  key: string,
  context: string,
): number | undefined {
  const value = raw[key];

  if (value === undefined || value === "") {
    return undefined;
  }

  return numberAttr(raw, key, context);
}

function stringAttr(
  raw: XmlNode,
  key: string,
  context: string,
  defaultValue?: string,
): string {
  const value = raw[key];

  if (value === undefined || value === "") {
    if (defaultValue !== undefined) {
      return defaultValue;
    }

    throw new Error(`Missing string attribute "${key}" on ${context}.`);
  }

  return String(value);
}

function optionalStringAttr(raw: XmlNode, key: string): string | undefined {
  const value = raw[key];

  if (value === undefined || value === "") {
    return undefined;
  }

  return String(value);
}

function booleanAttr(
  raw: XmlNode,
  key: string,
  defaultValue: boolean,
): boolean {
  const value = raw[key];

  if (value === undefined || value === "") {
    return defaultValue;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value === 1 || value === "1" || value === "true") {
    return true;
  }

  if (value === 0 || value === "0" || value === "false") {
    return false;
  }

  throw new Error(`Invalid boolean attribute "${key}": ${String(value)}.`);
}
