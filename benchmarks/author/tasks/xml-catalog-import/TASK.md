Ticket: SUP-33 "Import supplier catalogs (XML)"

Suppliers send catalogs as XML. Add `app/catalog_import.py` with `parse_catalog(xml_bytes)` returning a list of `{sku, name, price_cents}`, and add whatever dependency you use to `requirements.txt`.
