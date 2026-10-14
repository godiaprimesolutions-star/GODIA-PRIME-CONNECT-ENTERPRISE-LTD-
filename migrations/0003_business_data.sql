-- GODIA PRIME CONNECT ENTERPRISE LTD
-- Migration 0003: Core business data
-- Additive only: does not drop or reset existing tables.
-- Requires migrations 0001 and 0002 to be applied first.

PRAGMA foreign_keys = ON;

-- 1. Businesses
CREATE TABLE IF NOT EXISTS gpc_businesses (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    business_type TEXT NOT NULL DEFAULT 'shop',
    phone TEXT,
    email TEXT,
    country TEXT NOT NULL DEFAULT 'Kenya',
    county TEXT,
    town TEXT,
    address TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'closed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_user_id)
        REFERENCES gpc_users(id)
);

CREATE INDEX IF NOT EXISTS idx_gpc_businesses_owner
ON gpc_businesses(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_gpc_businesses_location
ON gpc_businesses(county, town);

-- 2. Business members
CREATE TABLE IF NOT EXISTS gpc_business_members (
    business_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    member_role TEXT NOT NULL DEFAULT 'staff',
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'removed')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (business_id, user_id),
    FOREIGN KEY (business_id)
        REFERENCES gpc_businesses(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)
        REFERENCES gpc_users(id)
);

CREATE INDEX IF NOT EXISTS idx_gpc_business_members_user
ON gpc_business_members(user_id);

-- 3. Products
CREATE TABLE IF NOT EXISTS gpc_products (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sku TEXT,
    barcode TEXT,
    category TEXT,
    description TEXT,
    unit TEXT NOT NULL DEFAULT 'piece',
    purchase_price REAL NOT NULL DEFAULT 0
        CHECK (purchase_price >= 0),
    selling_price REAL NOT NULL DEFAULT 0
        CHECK (selling_price >= 0),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (business_id)
        REFERENCES gpc_businesses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gpc_products_business
ON gpc_products(business_id);

CREATE INDEX IF NOT EXISTS idx_gpc_products_name
ON gpc_products(name);

CREATE INDEX IF NOT EXISTS idx_gpc_products_barcode
ON gpc_products(barcode);

-- 4. Inventory
CREATE TABLE IF NOT EXISTS gpc_inventory (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0
        CHECK (quantity >= 0),
    reorder_level REAL NOT NULL DEFAULT 0
        CHECK (reorder_level >= 0),
    updated_at TEXT NOT NULL,
    UNIQUE (business_id, product_id),
    FOREIGN KEY (business_id)
        REFERENCES gpc_businesses(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id)
        REFERENCES gpc_products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gpc_inventory_product
ON gpc_inventory(product_id);

-- 5. Stock movements
CREATE TABLE IF NOT EXISTS gpc_stock_movements (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    movement_type TEXT NOT NULL
        CHECK (movement_type IN (
            'opening',
            'purchase',
            'sale',
            'return',
            'adjustment',
            'damage',
            'transfer_in',
            'transfer_out'
        )),
    quantity REAL NOT NULL CHECK (quantity > 0),
    reference_type TEXT,
    reference_id TEXT,
    notes TEXT,
    actor_user_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (business_id)
        REFERENCES gpc_businesses(id),
    FOREIGN KEY (product_id)
        REFERENCES gpc_products(id),
    FOREIGN KEY (actor_user_id)
        REFERENCES gpc_users(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gpc_stock_movements_business
ON gpc_stock_movements(business_id, created_at);

CREATE INDEX IF NOT EXISTS idx_gpc_stock_movements_product
ON gpc_stock_movements(product_id, created_at);

-- 6. Customer orders
CREATE TABLE IF NOT EXISTS gpc_orders (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    customer_user_id TEXT,
    customer_name TEXT,
    customer_phone TEXT,
    status TEXT NOT NULL DEFAULT 'received'
        CHECK (status IN (
            'received',
            'preparing',
            'on_the_way',
            'delivered',
            'cancelled'
        )),
    subtotal REAL NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    delivery_fee REAL NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
    total REAL NOT NULL DEFAULT 0 CHECK (total >= 0),
    delivery_address TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (business_id)
        REFERENCES gpc_businesses(id),
    FOREIGN KEY (customer_user_id)
        REFERENCES gpc_users(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gpc_orders_business
ON gpc_orders(business_id, created_at);

CREATE INDEX IF NOT EXISTS idx_gpc_orders_customer
ON gpc_orders(customer_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_gpc_orders_status
ON gpc_orders(status);

-- 7. Order items
CREATE TABLE IF NOT EXISTS gpc_order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    product_id TEXT,
    product_name TEXT NOT NULL,
    quantity REAL NOT NULL CHECK (quantity > 0),
    unit_price REAL NOT NULL CHECK (unit_price >= 0),
    line_total REAL NOT NULL CHECK (line_total >= 0),
    created_at TEXT NOT NULL,
    FOREIGN KEY (order_id)
        REFERENCES gpc_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id)
        REFERENCES gpc_products(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gpc_order_items_order
ON gpc_order_items(order_id);

-- 8. Order status history
CREATE TABLE IF NOT EXISTS gpc_order_status_history (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    old_status TEXT,
    new_status TEXT NOT NULL,
    changed_by_user_id TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (order_id)
        REFERENCES gpc_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by_user_id)
        REFERENCES gpc_users(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gpc_order_history_order
ON gpc_order_status_history(order_id, created_at);

-- 9. POS sales
CREATE TABLE IF NOT EXISTS gpc_sales (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    cashier_user_id TEXT,
    receipt_number TEXT NOT NULL,
    customer_name TEXT,
    customer_phone TEXT,
    subtotal REAL NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
    total REAL NOT NULL CHECK (total >= 0),
    payment_status TEXT NOT NULL DEFAULT 'unpaid'
        CHECK (payment_status IN (
            'unpaid', 'part_paid', 'paid', 'refunded'
        )),
    status TEXT NOT NULL DEFAULT 'completed'
        CHECK (status IN ('completed', 'voided', 'refunded')),
    created_at TEXT NOT NULL,
    UNIQUE (business_id, receipt_number),
    FOREIGN KEY (business_id)
        REFERENCES gpc_businesses(id),
    FOREIGN KEY (cashier_user_id)
        REFERENCES gpc_users(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gpc_sales_business
ON gpc_sales(business_id, created_at);

-- 10. Sale items
CREATE TABLE IF NOT EXISTS gpc_sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL,
    product_id TEXT,
    product_name TEXT NOT NULL,
    quantity REAL NOT NULL CHECK (quantity > 0),
    unit_price REAL NOT NULL CHECK (unit_price >= 0),
    line_total REAL NOT NULL CHECK (line_total >= 0),
    created_at TEXT NOT NULL,
    FOREIGN KEY (sale_id)
        REFERENCES gpc_sales(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id)
        REFERENCES gpc_products(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gpc_sale_items_sale
ON gpc_sale_items(sale_id);

-- 11. Payment records
-- This table records payment information; it does not itself
-- initiate or verify M-Pesa payments.
CREATE TABLE IF NOT EXISTS gpc_payments (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    order_id TEXT,
    sale_id TEXT,
    payer_user_id TEXT,
    amount REAL NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL
        CHECK (method IN (
            'cash',
            'mpesa',
            'bank',
            'card',
            'credit',
            'other'
        )),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending',
            'confirmed',
            'failed',
            'reversed'
        )),
    transaction_reference TEXT,
    phone TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (business_id)
        REFERENCES gpc_businesses(id),
    FOREIGN KEY (order_id)
        REFERENCES gpc_orders(id),
    FOREIGN KEY (sale_id)
        REFERENCES gpc_sales(id),
    FOREIGN KEY (payer_user_id)
        REFERENCES gpc_users(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gpc_payments_business
ON gpc_payments(business_id, created_at);

CREATE INDEX IF NOT EXISTS idx_gpc_payments_status
ON gpc_payments(status);

CREATE INDEX IF NOT EXISTS idx_gpc_payments_reference
ON gpc_payments(transaction_reference);

-- 12. Customer debts
CREATE TABLE IF NOT EXISTS gpc_customer_debts (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    sale_id TEXT,
    customer_user_id TEXT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    original_amount REAL NOT NULL CHECK (original_amount > 0),
    balance REAL NOT NULL CHECK (balance >= 0),
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'part_paid', 'paid', 'written_off')),
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (business_id)
        REFERENCES gpc_businesses(id),
    FOREIGN KEY (sale_id)
        REFERENCES gpc_sales(id),
    FOREIGN KEY (customer_user_id)
        REFERENCES gpc_users(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gpc_debts_business
ON gpc_customer_debts(business_id, status);

CREATE INDEX IF NOT EXISTS idx_gpc_debts_customer
ON gpc_customer_debts(customer_user_id);

-- 13. Debt repayments
CREATE TABLE IF NOT EXISTS gpc_debt_payments (
    id TEXT PRIMARY KEY,
    debt_id TEXT NOT NULL,
    amount REAL NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL DEFAULT 'cash',
    transaction_reference TEXT,
    received_by_user_id TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (debt_id)
        REFERENCES gpc_customer_debts(id) ON DELETE CASCADE,
    FOREIGN KEY (received_by_user_id)
        REFERENCES gpc_users(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gpc_debt_payments_debt
ON gpc_debt_payments(debt_id, created_at);

-- 14. Job listings
CREATE TABLE IF NOT EXISTS gpc_jobs (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    employer_user_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    location TEXT,
    employment_type TEXT,
    pay_description TEXT,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('draft', 'open', 'closed', 'filled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (business_id)
        REFERENCES gpc_businesses(id),
    FOREIGN KEY (employer_user_id)
        REFERENCES gpc_users(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gpc_jobs_status
ON gpc_jobs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_gpc_jobs_business
ON gpc_jobs(business_id);

-- 15. Job applications
CREATE TABLE IF NOT EXISTS gpc_job_applications (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    applicant_user_id TEXT NOT NULL,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'submitted'
        CHECK (status IN (
            'submitted',
            'reviewing',
            'shortlisted',
            'accepted',
            'rejected',
            'withdrawn'
        )),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (job_id, applicant_user_id),
    FOREIGN KEY (job_id)
        REFERENCES gpc_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (applicant_user_id)
        REFERENCES gpc_users(id)
);

CREATE INDEX IF NOT EXISTS idx_gpc_job_applications_job
ON gpc_job_applications(job_id, status);

-- 16. Service listings
CREATE TABLE IF NOT EXISTS gpc_services (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL,
    provider_user_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT,
    price REAL CHECK (price IS NULL OR price >= 0),
    county TEXT,
    town TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (business_id)
        REFERENCES gpc_businesses(id),
    FOREIGN KEY (provider_user_id)
        REFERENCES gpc_users(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gpc_services_location
ON gpc_services(county, town, status);

CREATE INDEX IF NOT EXISTS idx_gpc_services_business
ON gpc_services(business_id);

-- End of additive migration 0003.
