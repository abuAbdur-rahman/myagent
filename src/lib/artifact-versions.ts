import { splitArtifactSegments } from "./artifacts";
import { siblingVersions } from "./message-tree";
import { parseDeclaredArtifacts } from "./message-parse";
import type { Message } from "./types";

export type ArtifactLocator =
  | { kind: "fence"; index: number }
  | { kind: "tool"; index: number };

export interface ArtifactVersion {
  id: string;
  messageId: string;
  locator: ArtifactLocator;
  title: string;
  lang: string;
  code: string;
  index: number;
  total: number;
}

function artifactAt(message: Message, locator: ArtifactLocator) {
  if (locator.kind === "tool") {
    return parseDeclaredArtifacts(message.artifacts)[locator.index] ?? null;
  }
  const artifacts = splitArtifactSegments(message.content).flatMap((segment) =>
    segment.kind === "artifact" ? [segment.artifact] : [],
  );
  const artifact = artifacts[locator.index];
  return artifact ? { ...artifact, title: `${artifact.title}.html` } : null;
}

export function artifactVersions(
  messageId: string,
  locator: ArtifactLocator,
  rows: Message[],
): ArtifactVersion[] {
  const source = rows.find((message) => message.id === messageId);
  if (!source) return [];
  const found = siblingVersions(source, rows).flatMap((message) => {
    const artifact = artifactAt(message, locator);
    return artifact
      ? [
          {
            id: `${message.id}:${locator.kind}:${locator.index}`,
            messageId: message.id,
            locator,
            title: artifact.title,
            lang: artifact.lang,
            code: artifact.code,
          },
        ]
      : [];
  });
  return found.map((artifact, index) => ({
    ...artifact,
    index: index + 1,
    total: found.length,
  }));
}
