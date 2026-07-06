// Cairo Context type augmentation.
//
// ts-for-gir emits Cairo's `Context` as an empty "foreign struct" — the C
// library isn't fully introspectable, so `import Cairo from 'gi://cairo?version=1.0'`
// yields a `Cairo.Context` with NO drawing methods. `cr.rectangle`,
// `cr.setSourceRGBA`, `cr.arc`, … are untyped in the IDE even though they exist
// at runtime (the running shell calls them fine).
//
// The supplementary `@girs/cairo.d.ts` (bare module 'cairo') defines the full
// method surface, but it isn't runtime-importable here (no bundler alias maps
// 'cairo' → 'gi://cairo?version=1.0'), and re-using its `Context` directly
// creates a type cycle (it `extends` the gi:// Context). Instead, this ambient
// declaration merges the method signatures onto the gi:// Context via
// interface/class declaration merging, so the runtime-correct
// `gi://cairo?version=1.0` import is also type-correct.
//
// `TextExtents`/`FontExtents` are records the gi:// namespace doesn't expose
// (only the bare module does), so they're referenced via `import('cairo')`.
// Affects every consumer of `Cairo.Context` (region-selector, sunArc,
// recording-boundary, …) without touching runtime code or build config.
declare module 'gi://cairo?version=1.0' {
    export namespace cairo {
        interface Context {
            $dispose(): void;
            arc(
                xc: number,
                yc: number,
                radius: number,
                angle1: number,
                angle2: number
            ): void;
            arcNegative(
                xc: number,
                yc: number,
                radius: number,
                angle1: number,
                angle2: number
            ): void;
            curveTo(
                x1: number,
                y1: number,
                x2: number,
                y2: number,
                x3: number,
                y3: number
            ): void;
            clip(): void;
            clipPreserve(): void;
            clipExtents(): [number, number, number, number];
            closePath(): void;
            copyPage(): void;
            deviceToUser(x: number, y: number): [number, number];
            deviceToUserDistance(x: number, y: number): [number, number];
            fill(): void;
            fillPreserve(): void;
            fillExtents(): [number, number, number, number];
            getAntialias(): Antialias;
            getCurrentPoint(): [number, number];
            getDashCount(): number;
            getFillRule(): FillRule;
            getLineCap(): LineCap;
            getLineJoin(): LineJoin;
            getLineWidth(): number;
            getMiterLimit(): number;
            getOperator(): Operator;
            getSource(): Pattern;
            getTarget(): Surface;
            getGroupTarget(): Surface;
            getTolerance(): number;
            hasCurrentPoint(): boolean;
            identityMatrix(): void;
            inFill(x: number, y: number): boolean;
            inStroke(x: number, y: number): boolean;
            lineTo(x: number, y: number): void;
            mask(pattern: Pattern): void;
            maskSurface(surface: Surface, x: number, y: number): void;
            moveTo(x: number, y: number): void;
            newPath(): void;
            newSubPath(): void;
            paint(): void;
            paintWithAlpha(alpha: number): void;
            pathExtents(): [number, number, number, number];
            popGroup(): Pattern;
            popGroupToSource(): void;
            pushGroup(): void;
            pushGroupWithContent(content: Content): void;
            rectangle(
                x: number,
                y: number,
                width: number,
                height: number
            ): void;
            relCurveTo(
                dx1: number,
                dy1: number,
                dx2: number,
                dy2: number,
                dx3: number,
                dy3: number
            ): void;
            relLineTo(dx: number, dy: number): void;
            relMoveTo(dx: number, dy: number): void;
            resetClip(): void;
            restore(): void;
            rotate(angle: number): void;
            save(): void;
            scale(sx: number, sy: number): void;
            selectFontFace(family: string, slant: number, weight: number): void;
            setAntialias(antialias: Antialias): void;
            setDash(dashes: number[], offset: number): void;
            setFontSize(size: number): void;
            setFillRule(fillRule: FillRule): void;
            setLineCap(lineCap: LineCap): void;
            setLineJoin(lineJoin: LineJoin): void;
            setLineWidth(width: number): void;
            setMiterLimit(limit: number): void;
            setOperator(op: Operator): void;
            setSource(pattern: Pattern): void;
            setSourceRGB(red: number, green: number, blue: number): void;
            setSourceRGBA(
                red: number,
                green: number,
                blue: number,
                alpha: number
            ): void;
            setSourceSurface(surface: Surface, x: number, y: number): void;
            setTolerance(tolerance: number): void;
            showPage(): void;
            showText(utf8: string): void;
            textPath(utf8: string): void;
            stroke(): void;
            strokePreserve(): void;
            strokeExtents(): [number, number, number, number];
            textExtents(utf8: string): import('cairo').TextExtents;
            fontExtents(): import('cairo').FontExtents;
            showGlyphs(glyphs: Glyph[]): void;
            glyphExtents(glyphs: Glyph[]): import('cairo').TextExtents;
            translate(tx: number, ty: number): void;
            userToDevice(x: number, y: number): [number, number];
            userToDeviceDistance(x: number, y: number): [number, number];
            copyPath(): Path;
            copyPathFlat(): Path;
            appendPath(path: Path): void;
        }
    }
}
