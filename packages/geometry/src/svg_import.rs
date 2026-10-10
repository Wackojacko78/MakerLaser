//! SVG import: `line`, `polyline`, `polygon`, `path` (all commands), `rect` (including
//! rounded corners), `circle` and `ellipse`, inside arbitrarily nested `<g>` groups with
//! `transform` attributes. Curves are flattened to polylines; the result is in
//! millimetres, in the SVG's own Y-down orientation (which is the workspace orientation).
//!
//! `use` is expanded: a copy of the element it points at (a shape, a group, another `use` or a
//! `symbol`) is drawn where `x`, `y` and the `use`'s own `transform` put it, inside any number of
//! nested groups. A `symbol` with a `viewBox` is scaled to the `width` and `height` of the `use`.
//!
//! Not imported (reported as warnings): `text`, `image`, a `use` that points at another file or at
//! nothing, and anything inside `defs`, `clipPath`, `mask`, `symbol`, `pattern`, `marker` that no
//! `use` points at.

use std::collections::{BTreeSet, HashMap};

use makerlaser_common::{Path2D, Point2, Transform2D};
use roxmltree::{Document, Node, NodeId, ParsingOptions};

use crate::bezier::{arc_points, flatten_cubic_bezier, flatten_quadratic_bezier, flatten_svg_arc};
use crate::error::{GeometryError, Result};

/// Target flattening accuracy in millimetres.
const FLATTEN_TOLERANCE_MM: f64 = 0.02;
const MM_PER_INCH: f64 = 25.4;
const CSS_PX_PER_INCH: f64 = 96.0;

#[derive(Debug, Clone, Default)]
pub struct SvgImportResult {
    pub paths: Vec<Path2D>,
    pub warnings: Vec<String>,
}

struct Ctx<'a, 'input: 'a> {
    /// Flattening tolerance expressed in SVG user units.
    tol: f64,
    paths: Vec<Path2D>,
    warnings: BTreeSet<String>,
    /// Every element that has an `id`, for `<use>` to find what it points at.
    ids: HashMap<&'a str, Node<'a, 'input>>,
    /// The elements being expanded by a `<use>` right now, to catch a reference that loops back.
    active: Vec<NodeId>,
    /// How many `<use>` elements have been expanded (a cap keeps a hostile file from exploding).
    uses: usize,
}

struct View {
    mm_per_unit: f64,
    min_x: f64,
    min_y: f64,
}

pub fn parse_svg(content: &str) -> Result<SvgImportResult> {
    // Illustrator and some other exporters emit a DOCTYPE with entity declarations.
    let options = ParsingOptions {
        allow_dtd: true,
        ..Default::default()
    };
    let doc = Document::parse_with_options(content, options)
        .map_err(|e| GeometryError::SvgParse(e.to_string()))?;
    let root = doc.root_element();
    if root.tag_name().name() != "svg" {
        return Err(GeometryError::SvgParse("root element is not <svg>".into()));
    }

    let view = document_view(&root);
    let mut ctx = Ctx {
        tol: (FLATTEN_TOLERANCE_MM / view.mm_per_unit).clamp(1e-9, 1e9),
        paths: Vec::new(),
        warnings: BTreeSet::new(),
        ids: collect_ids(&doc),
        active: Vec::new(),
        uses: 0,
    };
    walk(root, Transform2D::IDENTITY, &mut ctx)?;

    let to_mm = Transform2D::translate(-view.min_x, -view.min_y)
        .then(&Transform2D::scale(view.mm_per_unit, view.mm_per_unit));
    let paths = ctx
        .paths
        .into_iter()
        .map(|p| p.transformed(&to_mm))
        .collect();
    Ok(SvgImportResult {
        paths,
        warnings: ctx.warnings.into_iter().collect(),
    })
}

fn document_view(svg: &Node) -> View {
    let default_scale = MM_PER_INCH / CSS_PX_PER_INCH;
    let view_box = svg.attribute("viewBox").and_then(parse_view_box);
    let width_mm = svg.attribute("width").and_then(length_to_mm);
    match (view_box, width_mm) {
        (Some((x, y, w, _)), Some(mm)) if w > 0.0 => View {
            mm_per_unit: mm / w,
            min_x: x,
            min_y: y,
        },
        (Some((x, y, _, _)), _) => View {
            mm_per_unit: default_scale,
            min_x: x,
            min_y: y,
        },
        // Without a viewBox, user units are CSS pixels whatever unit `width` uses.
        _ => View {
            mm_per_unit: default_scale,
            min_x: 0.0,
            min_y: 0.0,
        },
    }
}

fn parse_view_box(v: &str) -> Option<(f64, f64, f64, f64)> {
    let mut sc = Scanner::new(v);
    let (x, y, w, h) = (sc.number()?, sc.number()?, sc.number()?, sc.number()?);
    Some((x, y, w, h))
}

/// Converts an SVG length to millimetres. Returns `None` for percentages and unknown units.
fn length_to_mm(value: &str) -> Option<f64> {
    let value = value.trim();
    let split = value
        .find(|c: char| c.is_ascii_alphabetic() || c == '%')
        .unwrap_or(value.len());
    let number: f64 = value[..split].trim().parse().ok()?;
    let mm = match &value[split..] {
        "mm" => number,
        "cm" => number * 10.0,
        "in" => number * MM_PER_INCH,
        "pt" => number * MM_PER_INCH / 72.0,
        "pc" => number * MM_PER_INCH / 6.0,
        "px" | "" => number * MM_PER_INCH / CSS_PX_PER_INCH,
        _ => return None,
    };
    if mm.is_finite() {
        Some(mm)
    } else {
        None
    }
}

fn is_hidden(node: &Node) -> bool {
    if node.attribute("display") == Some("none") {
        return true;
    }
    node.attribute("style")
        .map(|s| s.replace(' ', "").contains("display:none"))
        .unwrap_or(false)
}

fn walk(node: Node, parent: Transform2D, ctx: &mut Ctx) -> Result<()> {
    if !node.is_element() || is_hidden(&node) {
        return Ok(());
    }
    // A child's own transform is applied first, then its ancestors'.
    let local = node
        .attribute("transform")
        .map(parse_transform_list)
        .unwrap_or(Transform2D::IDENTITY);
    let t = local.then(&parent);
    let tol = ctx.tol;

    match node.tag_name().name() {
        "svg" | "g" | "a" | "switch" => {
            for child in node.children() {
                walk(child, t, ctx)?;
            }
        }
        "line" => push(ctx, parse_line(&node), &t),
        "polyline" => push(ctx, parse_poly(&node, false), &t),
        "polygon" => push(ctx, parse_poly(&node, true), &t),
        "rect" => push(ctx, parse_rect(&node, tol), &t),
        "circle" => push(ctx, parse_ellipse(&node, true, tol), &t),
        "ellipse" => push(ctx, parse_ellipse(&node, false, tol), &t),
        "path" => {
            if let Some(d) = node.attribute("d") {
                let subpaths = parse_path_data(d, tol)?;
                for sp in subpaths {
                    push(ctx, Some(sp), &t);
                }
            }
        }
        "text" | "tspan" => {
            ctx.warnings.insert(
                "Text is not imported: convert text to paths before importing.".to_string(),
            );
        }
        "image" => {
            ctx.warnings.insert(
                "Embedded <image> elements are not imported: import the picture directly."
                    .to_string(),
            );
        }
        "use" => expand_use(&node, t, ctx)?,
        // Non-rendering or definition-only content.
        "defs" | "clipPath" | "mask" | "symbol" | "pattern" | "marker" | "metadata" | "title"
        | "desc" | "style" | "script" | "linearGradient" | "radialGradient" | "filter"
        | "foreignObject" | "namedview" => {}
        _ => {}
    }
    Ok(())
}

/// Limits on `<use>`. Without them, a file whose groups each use the previous one ten times would
/// ask for billions of copies.
const MAX_USE_DEPTH: usize = 24;
const MAX_USE_EXPANSIONS: usize = 50_000;
const MAX_IMPORTED_PATHS: usize = 2_000_000;

/// Every element that has an `id`, so `<use>` can find what it points at. If two elements share an
/// id the first one wins, as in a browser.
fn collect_ids<'a, 'input>(doc: &'a Document<'input>) -> HashMap<&'a str, Node<'a, 'input>> {
    let mut ids = HashMap::new();
    for node in doc.root().descendants() {
        if !node.is_element() {
            continue;
        }
        if let Some(id) = node.attribute("id") {
            if !id.is_empty() {
                ids.entry(id).or_insert(node);
            }
        }
    }
    ids
}

/// The `href` of a `<use>`, written either `href` or `xlink:href`.
fn href_of<'n>(node: &'n Node) -> Option<&'n str> {
    for attribute in node.attributes() {
        if attribute.name() == "href" {
            return Some(attribute.value());
        }
    }
    None
}

/// Maps a `<symbol>`'s own coordinates into the `<use>` that shows it. A symbol with a `viewBox` is
/// scaled to fit the `width` and `height` of the `<use>`, keeping its proportions and centred (the
/// default). A `<use>` with no size shows it at its own scale.
fn symbol_view(symbol: &Node, use_node: &Node) -> Transform2D {
    let Some((vx, vy, vw, vh)) = symbol.attribute("viewBox").and_then(parse_view_box) else {
        return Transform2D::IDENTITY;
    };
    if !(vw > 0.0 && vh > 0.0) {
        return Transform2D::IDENTITY;
    }
    let shift = Transform2D::translate(-vx, -vy);
    let (w, h) = (
        attr_f64(use_node, "width", 0.0),
        attr_f64(use_node, "height", 0.0),
    );
    if w > 0.0 && h > 0.0 {
        let s = (w / vw).min(h / vh);
        let (ox, oy) = ((w - vw * s) / 2.0, (h - vh * s) / 2.0);
        shift
            .then(&Transform2D::scale(s, s))
            .then(&Transform2D::translate(ox, oy))
    } else {
        shift
    }
}

/// Draws a copy of the element a `<use>` points at. `t` is the transform of the `<use>` itself
/// (its own `transform` and its ancestors'); `x` and `y` move the copy before that.
fn expand_use(node: &Node, t: Transform2D, ctx: &mut Ctx) -> Result<()> {
    let Some(id) = href_of(node).and_then(|href| href.trim().strip_prefix('#')) else {
        ctx.warnings.insert(
            "A <use> that does not point at an element in this file was skipped.".to_string(),
        );
        return Ok(());
    };
    let Some(target) = ctx.ids.get(id.trim()).copied() else {
        ctx.warnings.insert(
            "A <use> points at an element that is not in the file, so it was skipped.".to_string(),
        );
        return Ok(());
    };
    // A <use> inside what it points at (or in a chain that comes back round) would never end.
    if node.ancestors().any(|a| a.id() == target.id()) || ctx.active.contains(&target.id()) {
        ctx.warnings
            .insert("A <use> that refers back to itself was skipped.".to_string());
        return Ok(());
    }
    if ctx.active.len() >= MAX_USE_DEPTH
        || ctx.uses >= MAX_USE_EXPANSIONS
        || ctx.paths.len() >= MAX_IMPORTED_PATHS
    {
        ctx.warnings
            .insert("Too many <use> references: the rest were skipped.".to_string());
        return Ok(());
    }
    ctx.uses += 1;

    let placed =
        Transform2D::translate(attr_f64(node, "x", 0.0), attr_f64(node, "y", 0.0)).then(&t);
    ctx.active.push(target.id());
    let outcome = if target.tag_name().name() == "symbol" {
        let content = symbol_view(&target, node).then(&placed);
        target
            .children()
            .try_for_each(|child| walk(child, content, ctx))
    } else {
        walk(target, placed, ctx)
    };
    ctx.active.pop();
    outcome
}

fn push(ctx: &mut Ctx, path: Option<Path2D>, t: &Transform2D) {
    if let Some(p) = path {
        let mut p = p.transformed(t);
        p.dedup(1e-9);
        let min_points = if p.closed { 3 } else { 2 };
        if p.points.len() >= min_points && p.points.iter().all(|q| q.is_finite()) {
            ctx.paths.push(p);
        }
    }
}

fn attr_f64(node: &Node, name: &str, default: f64) -> f64 {
    node.attribute(name)
        .and_then(|v| v.trim().trim_end_matches("px").trim().parse::<f64>().ok())
        .unwrap_or(default)
}

fn parse_line(node: &Node) -> Option<Path2D> {
    Some(Path2D::new(
        vec![
            Point2::new(attr_f64(node, "x1", 0.0), attr_f64(node, "y1", 0.0)),
            Point2::new(attr_f64(node, "x2", 0.0), attr_f64(node, "y2", 0.0)),
        ],
        false,
    ))
}

fn parse_poly(node: &Node, closed: bool) -> Option<Path2D> {
    let mut sc = Scanner::new(node.attribute("points")?);
    let mut pts = Vec::new();
    while let Some(x) = sc.number() {
        match sc.number() {
            Some(y) => pts.push(Point2::new(x, y)),
            None => break, // odd trailing coordinate is ignored, per the SVG error rules
        }
    }
    if pts.len() < 2 {
        return None;
    }
    Some(Path2D::new(pts, closed))
}

fn parse_rect(node: &Node, tol: f64) -> Option<Path2D> {
    let (x, y) = (attr_f64(node, "x", 0.0), attr_f64(node, "y", 0.0));
    let (w, h) = (attr_f64(node, "width", 0.0), attr_f64(node, "height", 0.0));
    if w <= 0.0 || h <= 0.0 {
        return None;
    }
    let mut rx = attr_f64(node, "rx", -1.0);
    let mut ry = attr_f64(node, "ry", -1.0);
    if rx < 0.0 && ry < 0.0 {
        rx = 0.0;
        ry = 0.0;
    } else if rx < 0.0 {
        rx = ry;
    } else if ry < 0.0 {
        ry = rx;
    }
    let rx = rx.min(w / 2.0);
    let ry = ry.min(h / 2.0);

    if rx <= 0.0 || ry <= 0.0 {
        return Some(Path2D::new(
            vec![
                Point2::new(x, y),
                Point2::new(x + w, y),
                Point2::new(x + w, y + h),
                Point2::new(x, y + h),
            ],
            true,
        ));
    }

    // Rounded rectangle, clockwise on screen: top edge, TR corner, right edge, BR corner,
    // bottom edge, BL corner, left edge, TL corner.
    use std::f64::consts::{FRAC_PI_2, PI};
    let mut pts = Vec::new();
    arc_points(
        x + w - rx,
        y + ry,
        rx,
        ry,
        0.0,
        -FRAC_PI_2,
        FRAC_PI_2,
        tol,
        &mut pts,
    );
    arc_points(
        x + w - rx,
        y + h - ry,
        rx,
        ry,
        0.0,
        0.0,
        FRAC_PI_2,
        tol,
        &mut pts,
    );
    arc_points(
        x + rx,
        y + h - ry,
        rx,
        ry,
        0.0,
        FRAC_PI_2,
        FRAC_PI_2,
        tol,
        &mut pts,
    );
    arc_points(x + rx, y + ry, rx, ry, 0.0, PI, FRAC_PI_2, tol, &mut pts);
    Some(Path2D::new(pts, true))
}

fn parse_ellipse(node: &Node, circle: bool, tol: f64) -> Option<Path2D> {
    let (cx, cy) = (attr_f64(node, "cx", 0.0), attr_f64(node, "cy", 0.0));
    let (rx, ry) = if circle {
        let r = attr_f64(node, "r", 0.0);
        (r, r)
    } else {
        (attr_f64(node, "rx", 0.0), attr_f64(node, "ry", 0.0))
    };
    if rx <= 0.0 || ry <= 0.0 {
        return None;
    }
    let mut pts = Vec::new();
    arc_points(
        cx,
        cy,
        rx,
        ry,
        0.0,
        0.0,
        2.0 * std::f64::consts::PI,
        tol,
        &mut pts,
    );
    Some(Path2D::new(pts, true))
}

/// Parses a `transform` attribute (a list of transform functions). Per the SVG spec the
/// list `A B C` means `A * B * C` applied to a point, i.e. **C is applied first**.
pub fn parse_transform_list(value: &str) -> Transform2D {
    let mut result = Transform2D::IDENTITY;
    let mut rest = value;
    while let Some(open) = rest.find('(') {
        let name = rest[..open]
            .trim_matches(|c: char| c.is_whitespace() || c == ',')
            .to_string();
        let Some(close) = rest[open..].find(')') else {
            break;
        };
        let close = open + close;
        let mut sc = Scanner::new(&rest[open + 1..close]);
        let mut args = Vec::new();
        while let Some(n) = sc.number() {
            args.push(n);
        }
        let arg = |i: usize, default: f64| args.get(i).copied().unwrap_or(default);

        let component = match name.as_str() {
            "translate" => Transform2D::translate(arg(0, 0.0), arg(1, 0.0)),
            "scale" => Transform2D::scale(arg(0, 1.0), arg(1, arg(0, 1.0))),
            "rotate" => {
                let rot = Transform2D::rotate_deg(arg(0, 0.0));
                if args.len() >= 3 {
                    Transform2D::translate(-args[1], -args[2])
                        .then(&rot)
                        .then(&Transform2D::translate(args[1], args[2]))
                } else {
                    rot
                }
            }
            "matrix" if args.len() == 6 => Transform2D {
                a: args[0],
                b: args[1],
                c: args[2],
                d: args[3],
                e: args[4],
                f: args[5],
            },
            "skewX" => Transform2D {
                c: arg(0, 0.0).to_radians().tan(),
                ..Transform2D::IDENTITY
            },
            "skewY" => Transform2D {
                b: arg(0, 0.0).to_radians().tan(),
                ..Transform2D::IDENTITY
            },
            _ => Transform2D::IDENTITY,
        };
        // `result` already holds the functions to the LEFT; the new one sits to its
        // right, so it is applied to a point before them.
        result = component.then(&result);
        rest = &rest[close + 1..];
    }
    result
}

fn err_num() -> GeometryError {
    GeometryError::SvgParse("expected a number in path data".into())
}

fn rel_point(relative: bool, cursor: Point2, x: f64, y: f64) -> Point2 {
    if relative {
        Point2::new(cursor.x + x, cursor.y + y)
    } else {
        Point2::new(x, y)
    }
}

/// Parses `<path d="...">` into subpaths. Every command is supported.
pub fn parse_path_data(d: &str, tol: f64) -> Result<Vec<Path2D>> {
    let mut sc = Scanner::new(d);
    let mut subpaths: Vec<Path2D> = Vec::new();
    let mut cur: Vec<Point2> = Vec::new();
    let mut cursor = Point2::ZERO;
    let mut start = Point2::ZERO;
    let mut last_cubic: Option<Point2> = None;
    let mut last_quad: Option<Point2> = None;
    let mut cmd: Option<char> = None;
    let mut first = true;

    macro_rules! num {
        () => {
            sc.number().ok_or_else(err_num)?
        };
    }

    loop {
        sc.skip_separators();
        if sc.at_end() {
            break;
        }
        if let Some(c) = sc.peek_alpha() {
            sc.advance();
            cmd = Some(c);
        } else if cmd.is_none() {
            return Err(GeometryError::SvgParse(
                "path data must start with a command".into(),
            ));
        }
        let Some(c) = cmd else {
            return Err(GeometryError::SvgParse(
                "path data must start with a command".into(),
            ));
        };
        let rel = c.is_ascii_lowercase();
        let upper = c.to_ascii_uppercase();
        if first && upper != 'M' {
            return Err(GeometryError::SvgParse(
                "path data must start with a moveto".into(),
            ));
        }
        first = false;
        if upper != 'M' && upper != 'Z' && cur.is_empty() {
            cur.push(cursor);
        }

        match upper {
            'M' => {
                if cur.len() >= 2 {
                    subpaths.push(Path2D::new(std::mem::take(&mut cur), false));
                } else {
                    cur.clear();
                }
                let (x, y) = (num!(), num!());
                let p = rel_point(rel, cursor, x, y);
                cursor = p;
                start = p;
                cur.push(p);
                last_cubic = None;
                last_quad = None;
                // Extra coordinate pairs after a moveto are implicit linetos.
                cmd = Some(if rel { 'l' } else { 'L' });
            }
            'L' => {
                let (x, y) = (num!(), num!());
                cursor = rel_point(rel, cursor, x, y);
                cur.push(cursor);
                last_cubic = None;
                last_quad = None;
            }
            'H' => {
                let x = num!();
                cursor = Point2::new(if rel { cursor.x + x } else { x }, cursor.y);
                cur.push(cursor);
                last_cubic = None;
                last_quad = None;
            }
            'V' => {
                let y = num!();
                cursor = Point2::new(cursor.x, if rel { cursor.y + y } else { y });
                cur.push(cursor);
                last_cubic = None;
                last_quad = None;
            }
            'C' | 'S' => {
                let c1 = if upper == 'C' {
                    let (x, y) = (num!(), num!());
                    rel_point(rel, cursor, x, y)
                } else {
                    match last_cubic {
                        Some(prev) => Point2::new(2.0 * cursor.x - prev.x, 2.0 * cursor.y - prev.y),
                        None => cursor,
                    }
                };
                let (x2, y2) = (num!(), num!());
                let (x, y) = (num!(), num!());
                let c2 = rel_point(rel, cursor, x2, y2);
                let end = rel_point(rel, cursor, x, y);
                let mut pts = Vec::new();
                flatten_cubic_bezier(cursor, c1, c2, end, tol, &mut pts);
                cur.extend(pts.into_iter().skip(1));
                cursor = end;
                last_cubic = Some(c2);
                last_quad = None;
            }
            'Q' | 'T' => {
                let c1 = if upper == 'Q' {
                    let (x, y) = (num!(), num!());
                    rel_point(rel, cursor, x, y)
                } else {
                    match last_quad {
                        Some(prev) => Point2::new(2.0 * cursor.x - prev.x, 2.0 * cursor.y - prev.y),
                        None => cursor,
                    }
                };
                let (x, y) = (num!(), num!());
                let end = rel_point(rel, cursor, x, y);
                let mut pts = Vec::new();
                flatten_quadratic_bezier(cursor, c1, end, tol, &mut pts);
                cur.extend(pts.into_iter().skip(1));
                cursor = end;
                last_quad = Some(c1);
                last_cubic = None;
            }
            'A' => {
                let (rx, ry, rot) = (num!(), num!(), num!());
                let large = sc.flag().ok_or_else(err_num)?;
                let sweep = sc.flag().ok_or_else(err_num)?;
                let (x, y) = (num!(), num!());
                let end = rel_point(rel, cursor, x, y);
                flatten_svg_arc(cursor, end, rx, ry, rot, large, sweep, tol, &mut cur);
                cursor = end;
                last_cubic = None;
                last_quad = None;
            }
            'Z' => {
                if cur.len() >= 2 {
                    subpaths.push(Path2D::new(std::mem::take(&mut cur), true));
                } else {
                    cur.clear();
                }
                cursor = start;
                last_cubic = None;
                last_quad = None;
                // Numbers directly after Z are invalid: force an explicit command.
                cmd = None;
            }
            other => {
                return Err(GeometryError::SvgParse(format!(
                    "unsupported path command '{other}'"
                )))
            }
        }
    }
    if cur.len() >= 2 {
        subpaths.push(Path2D::new(cur, false));
    }
    Ok(subpaths)
}

/// Scanner for the permissive number lists SVG allows (`10-5`, `.5.5`, `1e-3`, ...).
struct Scanner<'a> {
    s: &'a str,
    b: &'a [u8],
    i: usize,
}

impl<'a> Scanner<'a> {
    fn new(s: &'a str) -> Self {
        Scanner {
            s,
            b: s.as_bytes(),
            i: 0,
        }
    }

    fn skip_separators(&mut self) {
        while self.i < self.b.len()
            && (self.b[self.i].is_ascii_whitespace() || self.b[self.i] == b',')
        {
            self.i += 1;
        }
    }

    fn at_end(&self) -> bool {
        self.i >= self.b.len()
    }

    fn peek_alpha(&self) -> Option<char> {
        let c = *self.b.get(self.i)? as char;
        if c.is_ascii_alphabetic() {
            Some(c)
        } else {
            None
        }
    }

    fn advance(&mut self) {
        self.i += 1;
    }

    fn number(&mut self) -> Option<f64> {
        self.skip_separators();
        let start = self.i;
        let mut j = self.i;
        if j < self.b.len() && (self.b[j] == b'-' || self.b[j] == b'+') {
            j += 1;
        }
        let mut digits = false;
        while j < self.b.len() && self.b[j].is_ascii_digit() {
            j += 1;
            digits = true;
        }
        if j < self.b.len() && self.b[j] == b'.' {
            j += 1;
            while j < self.b.len() && self.b[j].is_ascii_digit() {
                j += 1;
                digits = true;
            }
        }
        if !digits {
            return None;
        }
        if j < self.b.len() && (self.b[j] == b'e' || self.b[j] == b'E') {
            let mut k = j + 1;
            if k < self.b.len() && (self.b[k] == b'-' || self.b[k] == b'+') {
                k += 1;
            }
            let exp_start = k;
            while k < self.b.len() && self.b[k].is_ascii_digit() {
                k += 1;
            }
            if k > exp_start {
                j = k;
            }
        }
        self.i = j;
        self.s[start..j].parse::<f64>().ok()
    }

    /// An arc flag is exactly one `0` or `1` character and may be unseparated.
    fn flag(&mut self) -> Option<bool> {
        self.skip_separators();
        let v = match self.b.get(self.i)? {
            b'0' => false,
            b'1' => true,
            _ => return None,
        };
        self.i += 1;
        Some(v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn svg(body: &str) -> String {
        format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">{body}</svg>"#
        )
    }

    #[test]
    fn rect_is_imported_in_millimetres() {
        let r = parse_svg(&svg(r#"<rect x="10" y="10" width="30" height="20"/>"#)).unwrap();
        assert_eq!(r.paths.len(), 1);
        let b = r.paths[0].bounding_box().unwrap();
        assert!((b.width() - 30.0).abs() < 1e-9 && (b.height() - 20.0).abs() < 1e-9);
    }

    #[test]
    fn document_scale_follows_width_and_viewbox() {
        let doc = r#"<svg xmlns="http://www.w3.org/2000/svg" width="2in" height="2in" viewBox="0 0 10 10">
            <rect width="10" height="10"/></svg>"#;
        let r = parse_svg(doc).unwrap();
        assert!((r.paths[0].bounding_box().unwrap().width() - 50.8).abs() < 1e-6);
    }

    #[test]
    fn viewbox_origin_is_removed() {
        let doc = r#"<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="50mm" viewBox="100 100 50 50">
            <rect x="110" y="120" width="10" height="10"/></svg>"#;
        let b = parse_svg(doc).unwrap().paths[0].bounding_box().unwrap();
        assert!((b.min.x - 10.0).abs() < 1e-9 && (b.min.y - 20.0).abs() < 1e-9);
    }

    #[test]
    fn percentage_width_falls_back_to_css_pixels() {
        let doc = r#"<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 96 96">
            <rect width="96" height="96"/></svg>"#;
        let b = parse_svg(doc).unwrap().paths[0].bounding_box().unwrap();
        assert!((b.width() - 25.4).abs() < 1e-6);
    }

    #[test]
    fn nested_groups_apply_inner_transform_first() {
        let body = r#"<g transform="translate(10,10)"><g transform="scale(2)">
            <rect x="0" y="0" width="5" height="5"/></g></g>"#;
        let b = parse_svg(&svg(body)).unwrap().paths[0]
            .bounding_box()
            .unwrap();
        assert!((b.min.x - 10.0).abs() < 1e-9 && (b.width() - 10.0).abs() < 1e-9);
    }

    #[test]
    fn transform_list_applies_rightmost_function_first() {
        // translate(10,0) scale(2): scale first, then translate: (1,0) -> (2,0) -> (12,0)
        let t = parse_transform_list("translate(10,0) scale(2)");
        let p = t.apply(Point2::new(1.0, 0.0));
        assert!((p.x - 12.0).abs() < 1e-9 && p.y.abs() < 1e-9);
        // scale(2) translate(10,0): translate first, then scale: (1,0) -> (11,0) -> (22,0)
        let t = parse_transform_list("scale(2) translate(10,0)");
        let p = t.apply(Point2::new(1.0, 0.0));
        assert!((p.x - 22.0).abs() < 1e-9);
    }

    #[test]
    fn rotate_about_a_point_keeps_that_point_fixed() {
        let t = parse_transform_list("rotate(90, 5, 5)");
        let p = t.apply(Point2::new(5.0, 5.0));
        assert!((p.x - 5.0).abs() < 1e-9 && (p.y - 5.0).abs() < 1e-9);
    }

    #[test]
    fn path_with_curve_and_close_is_one_closed_path() {
        let r = parse_svg(&svg(r#"<path d="M10,10 L90,10 C90,50 50,90 10,90 Z"/>"#)).unwrap();
        assert_eq!(r.paths.len(), 1);
        assert!(r.paths[0].closed && r.paths[0].points.len() > 4);
    }

    #[test]
    fn numbers_directly_after_z_are_an_error_not_an_infinite_loop() {
        assert!(parse_path_data("M0,0 L1,0 L1,1 Z 5,5", 0.01).is_err());
    }

    #[test]
    fn extra_pairs_after_moveto_are_linetos() {
        let sp = parse_path_data("M0,0 10,0 10,10", 0.01).unwrap();
        assert_eq!(sp.len(), 1);
        assert_eq!(sp[0].points.len(), 3);
    }

    #[test]
    fn drawing_after_close_starts_at_the_subpath_start() {
        let sp = parse_path_data("M0,0 L10,0 L10,10 Z L0,-5", 0.01).unwrap();
        assert_eq!(sp.len(), 2);
        assert!(sp[0].closed);
        assert_eq!(sp[1].points[0], Point2::new(0.0, 0.0));
    }

    #[test]
    fn relative_and_absolute_commands_agree() {
        let a = parse_path_data("M10,10 L20,10 L20,20 Z", 0.01).unwrap();
        let b = parse_path_data("m10,10 l10,0 l0,10 z", 0.01).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn arc_flags_may_be_unseparated() {
        let sp = parse_path_data("M0,0 A10,10 0 0110,10", 0.01).unwrap();
        assert_eq!(sp.len(), 1);
        assert_eq!(*sp[0].points.last().unwrap(), Point2::new(10.0, 10.0));
    }

    #[test]
    fn polyline_and_polygon_closure() {
        let r = parse_svg(&svg(
            r#"<polyline points="0,0 10,0 10,10"/><polygon points="20,20 30,20 30,30 20,30"/>"#,
        ))
        .unwrap();
        assert_eq!(r.paths.len(), 2);
        assert!(!r.paths[0].closed && r.paths[1].closed);
    }

    #[test]
    fn circle_is_closed_without_duplicate_end_point() {
        let r = parse_svg(&svg(r#"<circle cx="50" cy="50" r="10"/>"#)).unwrap();
        let p = &r.paths[0];
        assert!(p.closed);
        assert!(p.points[0].distance_to(p.points.last().unwrap()) > 1e-6);
        let b = p.bounding_box().unwrap();
        assert!((b.width() - 20.0).abs() < 0.05);
    }

    #[test]
    fn rounded_rect_stays_inside_its_box() {
        let r = parse_svg(&svg(r#"<rect x="0" y="0" width="40" height="20" rx="5"/>"#)).unwrap();
        let b = r.paths[0].bounding_box().unwrap();
        assert!((b.width() - 40.0).abs() < 1e-6 && (b.height() - 20.0).abs() < 1e-6);
        assert!(r.paths[0].points.len() > 8);
    }

    #[test]
    fn definitions_and_hidden_elements_are_not_imported() {
        let body = r#"<defs><rect width="5" height="5"/></defs>
            <rect width="5" height="5" display="none"/>
            <rect width="5" height="5" style="display: none"/>
            <rect x="1" y="1" width="5" height="5"/>"#;
        assert_eq!(parse_svg(&svg(body)).unwrap().paths.len(), 1);
    }

    #[test]
    fn unsupported_elements_produce_warnings() {
        let r = parse_svg(&svg(r##"<text x="1" y="1">hi</text><use href="#a"/>"##)).unwrap();
        assert!(r.paths.is_empty());
        assert_eq!(r.warnings.len(), 2);
    }

    #[test]
    fn use_places_a_copy_of_the_element_it_points_at() {
        let body = r##"<defs><rect id="r" width="10" height="5"/></defs>
            <use href="#r" x="20" y="30"/>"##;
        let r = parse_svg(&svg(body)).unwrap();
        assert_eq!(r.paths.len(), 1);
        assert!(r.warnings.is_empty(), "{:?}", r.warnings);
        let b = r.paths[0].bounding_box().unwrap();
        assert!((b.min.x - 20.0).abs() < 1e-9 && (b.min.y - 30.0).abs() < 1e-9);
        assert!((b.width() - 10.0).abs() < 1e-9 && (b.height() - 5.0).abs() < 1e-9);
    }

    #[test]
    fn a_use_combines_x_and_y_its_own_transform_and_the_transform_of_the_element() {
        // The group scales by 2 (rect 0..10), x moves it by 3, the use's transform by 10 more.
        let body = r##"<defs><g id="g" transform="scale(2)"><rect width="5" height="5"/></g></defs>
            <use href="#g" x="3" transform="translate(10,0)"/>"##;
        let b = parse_svg(&svg(body)).unwrap().paths[0]
            .bounding_box()
            .unwrap();
        assert!((b.min.x - 13.0).abs() < 1e-9 && (b.width() - 10.0).abs() < 1e-9);
    }

    #[test]
    fn use_inside_a_transformed_group_is_moved_with_the_group() {
        let body = r##"<defs><rect id="r" width="4" height="4"/></defs>
            <g transform="translate(50,60)"><use href="#r" x="1" y="2"/></g>"##;
        let b = parse_svg(&svg(body)).unwrap().paths[0]
            .bounding_box()
            .unwrap();
        assert!((b.min.x - 51.0).abs() < 1e-9 && (b.min.y - 62.0).abs() < 1e-9);
    }

    #[test]
    fn the_xlink_form_of_href_is_understood() {
        let doc = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
            width="100mm" height="100mm" viewBox="0 0 100 100">
            <defs><rect id="r" width="4" height="4"/></defs><use xlink:href="#r" x="7"/></svg>"##;
        let r = parse_svg(doc).unwrap();
        assert_eq!(r.paths.len(), 1);
        assert!((r.paths[0].bounding_box().unwrap().min.x - 7.0).abs() < 1e-9);
    }

    #[test]
    fn one_shape_used_many_times_gives_many_copies() {
        let body = r##"<defs><rect id="r" width="10" height="10"/></defs>
            <use href="#r"/><use href="#r" x="20"/><use href="#r" x="40"/>"##;
        let r = parse_svg(&svg(body)).unwrap();
        let mut starts: Vec<f64> = r
            .paths
            .iter()
            .map(|p| p.bounding_box().unwrap().min.x)
            .collect();
        starts.sort_by(f64::total_cmp);
        assert_eq!(starts.len(), 3);
        assert!((starts[0] - 0.0).abs() < 1e-9);
        assert!((starts[1] - 20.0).abs() < 1e-9);
        assert!((starts[2] - 40.0).abs() < 1e-9);
    }

    #[test]
    fn a_use_inside_defs_is_drawn_when_something_points_at_it() {
        let body = r##"<defs><rect id="a" width="5" height="5"/>
            <g id="b"><use href="#a" x="10"/></g></defs>
            <use href="#b" y="20"/>"##;
        let r = parse_svg(&svg(body)).unwrap();
        assert_eq!(r.paths.len(), 1);
        let b = r.paths[0].bounding_box().unwrap();
        assert!((b.min.x - 10.0).abs() < 1e-9 && (b.min.y - 20.0).abs() < 1e-9);
    }

    #[test]
    fn a_symbol_with_a_viewbox_is_scaled_to_the_size_of_the_use() {
        let body = r##"<defs><symbol id="s" viewBox="0 0 10 10"><rect width="10" height="10"/></symbol></defs>
            <use href="#s" x="5" y="5" width="30" height="30"/>"##;
        let b = parse_svg(&svg(body)).unwrap().paths[0]
            .bounding_box()
            .unwrap();
        assert!((b.min.x - 5.0).abs() < 1e-9 && (b.min.y - 5.0).abs() < 1e-9);
        assert!((b.width() - 30.0).abs() < 1e-9 && (b.height() - 30.0).abs() < 1e-9);
    }

    #[test]
    fn a_symbol_keeps_its_proportions_and_is_centred_in_a_use_of_another_shape() {
        // 10 x 10 into 40 x 20: scale 2, so 20 x 20, centred sideways (10 in from the left).
        let body = r##"<defs><symbol id="s" viewBox="0 0 10 10"><rect width="10" height="10"/></symbol></defs>
            <use href="#s" width="40" height="20"/>"##;
        let b = parse_svg(&svg(body)).unwrap().paths[0]
            .bounding_box()
            .unwrap();
        assert!((b.min.x - 10.0).abs() < 1e-9 && b.min.y.abs() < 1e-9);
        assert!((b.width() - 20.0).abs() < 1e-9 && (b.height() - 20.0).abs() < 1e-9);
    }

    #[test]
    fn a_symbol_with_no_size_given_keeps_its_own_scale_and_loses_its_viewbox_origin() {
        let body = r##"<defs><symbol id="s" viewBox="5 5 10 10"><rect x="5" y="5" width="10" height="10"/></symbol></defs>
            <use href="#s"/>"##;
        let b = parse_svg(&svg(body)).unwrap().paths[0]
            .bounding_box()
            .unwrap();
        assert!(b.min.x.abs() < 1e-9 && b.min.y.abs() < 1e-9);
        assert!((b.width() - 10.0).abs() < 1e-9);
    }

    #[test]
    fn a_use_that_points_at_nothing_warns_once_however_often_it_happens() {
        let r = parse_svg(&svg(r##"<use href="#nope"/><use href="#nope"/>"##)).unwrap();
        assert!(r.paths.is_empty());
        assert_eq!(r.warnings.len(), 1);
        assert!(
            r.warnings[0].contains("not in the file"),
            "{:?}",
            r.warnings
        );
    }

    #[test]
    fn a_use_that_points_at_another_file_or_has_no_href_is_skipped_with_a_warning() {
        let body = r##"<use href="other.svg#a"/><use x="5"/>"##;
        let r = parse_svg(&svg(body)).unwrap();
        assert!(r.paths.is_empty());
        assert_eq!(r.warnings.len(), 1);
        assert!(r.warnings[0].contains("does not point"), "{:?}", r.warnings);
    }

    #[test]
    fn a_use_inside_what_it_points_at_is_skipped_instead_of_followed_forever() {
        let r = parse_svg(&svg(
            r##"<g id="a"><rect width="5" height="5"/><use href="#a"/></g>"##,
        ))
        .unwrap();
        assert_eq!(r.paths.len(), 1);
        assert!(
            r.warnings.iter().any(|w| w.contains("itself")),
            "{:?}",
            r.warnings
        );
    }

    #[test]
    fn two_groups_that_use_each_other_stop_instead_of_looping() {
        let body = r##"<g id="a"><rect width="5" height="5"/><use href="#b"/></g>
            <g id="b"><use href="#a"/></g>"##;
        let r = parse_svg(&svg(body)).unwrap();
        assert!(
            !r.paths.is_empty() && r.paths.len() < 10,
            "{}",
            r.paths.len()
        );
        assert!(
            r.warnings.iter().any(|w| w.contains("itself")),
            "{:?}",
            r.warnings
        );
    }

    #[test]
    fn a_use_of_a_use_is_followed() {
        let body = r##"<defs><rect id="r" width="5" height="5"/><use id="u" href="#r" x="10"/></defs>
            <use href="#u" y="20"/>"##;
        let r = parse_svg(&svg(body)).unwrap();
        assert_eq!(r.paths.len(), 1);
        let b = r.paths[0].bounding_box().unwrap();
        assert!((b.min.x - 10.0).abs() < 1e-9 && (b.min.y - 20.0).abs() < 1e-9);
    }

    #[test]
    fn nested_uses_that_multiply_are_capped_rather_than_filling_the_computer() {
        // Each group uses the one below it ten times: seven levels would be ten million copies.
        let mut body = String::from(r#"<defs><rect id="g0" width="1" height="1"/>"#);
        for level in 1..=7 {
            body.push_str(&format!(r#"<g id="g{level}">"#));
            for i in 0..10 {
                body.push_str(&format!(r##"<use href="#g{}" x="{i}"/>"##, level - 1));
            }
            body.push_str("</g>");
        }
        body.push_str(r##"</defs><use href="#g7"/>"##);
        let r = parse_svg(&svg(&body)).unwrap();
        assert!(r.paths.len() <= MAX_USE_EXPANSIONS, "{}", r.paths.len());
        assert!(
            r.warnings.iter().any(|w| w.contains("Too many")),
            "{:?}",
            r.warnings
        );
    }

    #[test]
    fn hidden_uses_and_hidden_targets_are_not_drawn() {
        let body = r##"<defs><rect id="r" width="5" height="5"/></defs>
            <use href="#r" display="none"/><use href="#r" style="display: none"/>
            <rect id="h" width="5" height="5" display="none"/><use href="#h" x="20"/>"##;
        let r = parse_svg(&svg(body)).unwrap();
        assert!(r.paths.is_empty());
        assert!(r.warnings.is_empty(), "{:?}", r.warnings);
    }

    #[test]
    fn when_two_elements_share_an_id_the_first_is_used() {
        let body = r##"<defs><rect id="a" width="5" height="5"/><rect id="a" width="9" height="9"/></defs>
            <use href="#a"/>"##;
        let r = parse_svg(&svg(body)).unwrap();
        assert_eq!(r.paths.len(), 1);
        assert!((r.paths[0].bounding_box().unwrap().width() - 5.0).abs() < 1e-9);
    }

    #[test]
    fn doctype_declaration_is_accepted() {
        let doc = r#"<?xml version="1.0"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>"#;
        assert_eq!(parse_svg(doc).unwrap().paths.len(), 1);
    }

    #[test]
    fn number_scanner_handles_compact_forms() {
        let mut sc = Scanner::new("10-5.5,3 .5.5 1e-2");
        assert_eq!(sc.number(), Some(10.0));
        assert_eq!(sc.number(), Some(-5.5));
        assert_eq!(sc.number(), Some(3.0));
        assert_eq!(sc.number(), Some(0.5));
        assert_eq!(sc.number(), Some(0.5));
        assert_eq!(sc.number(), Some(0.01));
    }

    #[test]
    fn non_svg_root_is_rejected() {
        assert!(parse_svg("<html/>").is_err());
    }
}
