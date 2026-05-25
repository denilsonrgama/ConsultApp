import json
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
PAGE_WIDTH, PAGE_HEIGHT = A4
REGULAR_FONT = "ArialUnicode"
BOLD_FONT = "ArialUnicode-Bold"


def register_fonts():
    global REGULAR_FONT, BOLD_FONT

    fonts_dir = Path("C:/Windows/Fonts")
    regular = fonts_dir / "arial.ttf"
    bold = fonts_dir / "arialbd.ttf"

    try:
        pdfmetrics.registerFont(TTFont(REGULAR_FONT, str(regular)))
        pdfmetrics.registerFont(TTFont(BOLD_FONT, str(bold)))
    except Exception:
        REGULAR_FONT = "Helvetica"
        BOLD_FONT = "Helvetica-Bold"


def money(value):
    value = float(value or 0)
    text = f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {text}"


def date_br(value):
    if not value:
        return ""
    parts = str(value).split("-")
    if len(parts) == 3:
        return f"{parts[2]}/{parts[1]}/{parts[0]}"
    return str(value)


def draw_img(c, path, x_mm, top_mm, w_mm, h_mm, mask=None):
    x = x_mm * mm
    y = PAGE_HEIGHT - (top_mm + h_mm) * mm
    c.drawImage(str(path), x, y, width=w_mm * mm, height=h_mm * mm, mask=mask)


def draw_cover(c, path):
    from PIL import Image

    image = Image.open(path)
    image_ratio = image.width / image.height
    page_ratio = PAGE_WIDTH / PAGE_HEIGHT
    if image_ratio > page_ratio:
        height = PAGE_HEIGHT
        width = height * image_ratio
        x = (PAGE_WIDTH - width) / 2
        y = 0
    else:
        width = PAGE_WIDTH
        height = width / image_ratio
        x = 0
        y = (PAGE_HEIGHT - height) / 2
    c.drawImage(str(path), x, y, width=width, height=height)


def text(c, x_mm, top_mm, value, font=None, size=11, color=colors.black):
    font = font or REGULAR_FONT
    c.setFillColor(color)
    c.setFont(font, size)
    c.drawString(x_mm * mm, PAGE_HEIGHT - top_mm * mm, str(value or ""))


def centered(c, top_mm, value, font=None, size=30, color=colors.HexColor("#20232b")):
    font = font or BOLD_FONT
    c.setFillColor(color)
    c.setFont(font, size)
    c.drawCentredString(PAGE_WIDTH / 2, PAGE_HEIGHT - top_mm * mm, str(value or ""))


def fit_text(c, value, max_width, font=None, size=10):
    font = font or REGULAR_FONT
    value = str(value or "")
    c.setFont(font, size)
    if c.stringWidth(value, font, size) <= max_width:
        return value
    ellipsis = "..."
    while value and c.stringWidth(value + ellipsis, font, size) > max_width:
        value = value[:-1]
    return value + ellipsis


def line_items_total(items):
    return sum(float(i.get("quantidade") or 0) * float(i.get("valorUnitario") or 0) - float(i.get("desconto") or 0) for i in items)


def draw_budget_page(c, payload):
    budget = payload["orcamento"]
    cliente = payload["cliente"]
    items = payload["itens"]

    draw_cover(c, ASSETS / "fundo-formulario.png")
    draw_img(c, ASSETS / "pdf-ref-images" / "page3-img2.png", 59.1, 27.7, 95.6, 31.5, mask="auto")
    centered(c, 56.5, f"Nr. {budget.get('numero')}", size=30)

    label_x = 9.9
    value_x = 36.9
    text(c, label_x, 78, "Cliente:", BOLD_FONT, 14)
    text(c, value_x, 78, cliente.get("nome"), REGULAR_FONT, 14)

    address = " - ".join(
        str(part)
        for part in [
            cliente.get("endereco"),
            cliente.get("numero"),
            cliente.get("bairro"),
            cliente.get("cidade"),
            f"({cliente.get('uf')})" if cliente.get("uf") else "",
        ]
        if part
    )
    c.setFont(REGULAR_FONT, 12)
    text(c, label_x, 84.2, "Endereço:", BOLD_FONT, 12)
    text(c, value_x, 84.2, fit_text(c, address, 104 * mm, REGULAR_FONT, 12), REGULAR_FONT, 12)
    text(c, 144, 84.2, "Telefone:", BOLD_FONT, 12)
    text(c, 166, 84.2, cliente.get("telefone"), REGULAR_FONT, 12)
    text(c, label_x, 92, "Data:", BOLD_FONT, 14)
    text(c, value_x, 92, date_br(budget.get("data")), REGULAR_FONT, 14)

    x = 7 * mm
    y_top = PAGE_HEIGHT - 99.5 * mm
    widths = [18 * mm, 70 * mm, 13 * mm, 29 * mm, 29 * mm, 31 * mm]
    row_h = 10 * mm
    headers = ["Código", "Produto", "Qtd.", "Vlr.Unit", "Descontos", "Vlr Total"]

    c.setStrokeColor(colors.HexColor("#8c8c8c"))
    c.setLineWidth(0.34 * mm)
    c.setFont(BOLD_FONT, 10)
    cx = x
    for idx, header in enumerate(headers):
        c.rect(cx, y_top - row_h, widths[idx], row_h, stroke=1, fill=0)
        c.drawCentredString(cx + widths[idx] / 2, y_top - 6.5 * mm, header)
        cx += widths[idx]

    c.setFont(REGULAR_FONT, 9.5)
    y = y_top - row_h
    for item in items:
        y -= row_h
        cx = x
        service_name = item.get("servicoNome") or item.get("servicoCodigo")
        line_total = float(item.get("quantidade") or 0) * float(item.get("valorUnitario") or 0) - float(item.get("desconto") or 0)
        values = [
            item.get("servicoCodigo"),
            fit_text(c, service_name, widths[1] - 4 * mm, REGULAR_FONT, 9.5),
            str(int(float(item.get("quantidade") or 0))).zfill(2),
            money(item.get("valorUnitario")),
            money(item.get("desconto")),
            money(line_total),
        ]
        for idx, value in enumerate(values):
            c.rect(cx, y, widths[idx], row_h, stroke=1, fill=0)
            if idx in [0, 2]:
                c.drawCentredString(cx + widths[idx] / 2, y + 3.5 * mm, str(value))
            elif idx >= 3:
                c.drawRightString(cx + widths[idx] - 2 * mm, y + 3.5 * mm, str(value))
            else:
                c.drawString(cx + 2 * mm, y + 3.5 * mm, str(value))
            cx += widths[idx]

    text(c, 120, 197, "Valor Total:", BOLD_FONT, 13)
    c.setFont(BOLD_FONT, 13)
    c.drawRightString(200 * mm, PAGE_HEIGHT - 197 * mm, money(line_items_total(items)))

    terms = [
        f"1. Total do orçamento: {money(line_items_total(items))}",
        "2. Forma de pagamento: À combinar",
        "3. Validade do Orçamento: 10 dias a contar do recebimento",
        "4. Garantia: 1 ano",
    ]
    top = 209
    for term in terms:
        text(c, 12, top, term, REGULAR_FONT, 11)
        top += 7

    c.setFont(REGULAR_FONT, 11)
    c.drawCentredString(107 * mm, PAGE_HEIGHT - 246 * mm, "Concordo e aprovo,")
    c.line(68 * mm, PAGE_HEIGHT - 260 * mm, 146 * mm, PAGE_HEIGHT - 260 * mm)
    c.setFont(BOLD_FONT, 11)
    c.drawCentredString(107 * mm, PAGE_HEIGHT - 265 * mm, "Assinatura do Responsável")
    c.setFont(REGULAR_FONT, 11)
    c.drawCentredString(107 * mm, PAGE_HEIGHT - 271 * mm, str(cliente.get("nome") or ""))
    c.drawCentredString(107 * mm, PAGE_HEIGHT - 277 * mm, date_br(budget.get("data")))

    if budget.get("observacoes"):
        text(c, 9.5, 286, budget.get("observacoes"), REGULAR_FONT, 10)


def main():
    register_fonts()

    payload = json.loads(sys.stdin.read())
    output = Path(payload["output"])
    output.parent.mkdir(parents=True, exist_ok=True)

    c = canvas.Canvas(str(output), pagesize=A4)
    draw_img(c, ASSETS / "pdf-ref-images" / "page1-img1.jpg", 2.96, 19.98, 197.45, 253.86)
    c.showPage()
    draw_img(c, ASSETS / "pdf-ref-images" / "page2-img1.jpg", 2.96, 22.09, 198.57, 253.79)
    c.showPage()
    draw_budget_page(c, payload)
    c.showPage()
    draw_img(c, ASSETS / "pdf-ref-images" / "page4-img1.jpg", 2.96, 31.06, 198.0, 243.4)
    c.save()
    print(output)


if __name__ == "__main__":
    main()
