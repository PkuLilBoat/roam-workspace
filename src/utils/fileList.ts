export interface PathIdentifiedFile {
    path: string;
    extension?: string;
}

export interface FolderLike {
    children: Array<PathIdentifiedFile | FolderLike>;
}

export function isMarkdownFile(file: PathIdentifiedFile): boolean {
    return file.extension === "md" || file.path.toLowerCase().endsWith(".md");
}

export function isMarkdownPath(path: string): boolean {
    return path.toLowerCase().endsWith(".md");
}

export function removeFileByPath<T extends PathIdentifiedFile>(
    files: T[],
    file: PathIdentifiedFile
): T[] {
    return files.filter((existingFile) => existingFile.path !== file.path);
}

export function upsertFileByPath<T extends PathIdentifiedFile>(
    files: T[],
    file: T
): T[] {
    const existingIndex = files.findIndex(
        (existingFile) => existingFile.path === file.path
    );

    if (existingIndex === -1) {
        return [...files, file];
    }

    const nextFiles = [...files];
    nextFiles[existingIndex] = file;
    return nextFiles;
}

export function collectMarkdownFilesFromFolder(folder: FolderLike): PathIdentifiedFile[] {
    const files: PathIdentifiedFile[] = [];

    for (const child of folder.children) {
        if (isFolderLike(child)) {
            files.push(...collectMarkdownFilesFromFolder(child));
        } else if (isMarkdownFile(child)) {
            files.push(child);
        }
    }

    return files;
}

function isFolderLike(value: PathIdentifiedFile | FolderLike): value is FolderLike {
    return Array.isArray((value as FolderLike).children);
}
