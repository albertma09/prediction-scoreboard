revoke update, delete on prediction from :"app_role";
revoke update, delete on resolution from :"app_role";
revoke update, delete on ledger_anchor from :"app_role";
revoke delete on ohlcv_bar from :"app_role";
revoke all on schema_migration from :"app_role";
grant select, insert on prediction, resolution, ledger_anchor to :"app_role";
grant select, insert, update on ohlcv_bar to :"app_role";
