alter table instrument add column category text;

alter table instrument add constraint instrument_category_known
  check (
    category is null
    or category in ('crypto', 'commodity', 'equity', 'etf', 'index')
  );

update instrument set category = asset_class where category is null and asset_class <> 'fx';
update instrument set category = 'etf' where category is null;

create index instrument_category on instrument (category, symbol);
