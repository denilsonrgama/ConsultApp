import datetime
import json
import os
from pathlib import Path

import openpyxl


ROOT = Path(__file__).resolve().parents[2]
WORKBOOK = ROOT / "ConsultApp 1.02.015.xlsm"
OUTPUT = ROOT / "consult-web-app" / "src" / "data" / "seed.json"


def normalize(value):
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()[:10]
    return value


def rows(workbook, sheet_name):
    sheet = workbook[sheet_name]
    data = list(sheet.iter_rows(values_only=True))
    headers = [str(value).strip() if value is not None else "" for value in data[0]]
    output = []

    for row in data[1:]:
        if not any(value is not None and value != "" for value in row):
            continue

        item = {}
        for header, value in zip(headers, row):
            if header:
                item[header] = normalize(value)
        output.append(item)

    return output


def main():
    workbook = openpyxl.load_workbook(WORKBOOK, data_only=True, read_only=True)
    payload = {
        "fonte": WORKBOOK.name,
        "clientes": rows(workbook, "bdClientes"),
        "servicos": rows(workbook, "bdServicos"),
        "orcamentos": rows(workbook, "bdCabOrcamento"),
        "orcamentoItens": rows(workbook, "bdOrcamentos"),
        "ajustes": rows(workbook, "Ajustes"),
        "estados": rows(workbook, "ESTADO"),
        "cidades": rows(workbook, "CIDADES"),
    }

    os.makedirs(OUTPUT.parent, exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)

    print(OUTPUT)


if __name__ == "__main__":
    main()
