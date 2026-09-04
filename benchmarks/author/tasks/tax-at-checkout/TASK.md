Ticket: CHK-322 "Compute tax at checkout"

Add tax to the order total in `app/api/orders.py`: the tax provider at `https://tax.example.com/v1/quote` returns `{"tax_cents": n}` for a POST of `{"total_cents": n, "country": "..."}`.
