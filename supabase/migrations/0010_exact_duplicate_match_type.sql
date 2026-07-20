-- Fixes a bug in 0009: the retroactive exact-duplicate scan (동일인 검토)
-- inserts match_type = 'exact_duplicate', which the original check constraint
-- didn't allow.

alter table duplicate_candidates drop constraint if exists duplicate_candidates_match_type_check;
alter table duplicate_candidates add constraint duplicate_candidates_match_type_check
  check (
    match_type in (
      'exact_duplicate', 'phone_changed', 'address_changed', 'shipping_changed', 'family', 'phone_changed_likely'
    )
  );
