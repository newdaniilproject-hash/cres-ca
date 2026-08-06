// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'local_db.dart';

// ignore_for_file: type=lint
class $MaterialsTable extends Materials
    with TableInfo<$MaterialsTable, Material> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $MaterialsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _tenantIdMeta = const VerificationMeta(
    'tenantId',
  );
  @override
  late final GeneratedColumn<String> tenantId = GeneratedColumn<String>(
    'tenant_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
    'name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _unitMeta = const VerificationMeta('unit');
  @override
  late final GeneratedColumn<String> unit = GeneratedColumn<String>(
    'unit',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _categoryMeta = const VerificationMeta(
    'category',
  );
  @override
  late final GeneratedColumn<String> category = GeneratedColumn<String>(
    'category',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _currentStockMeta = const VerificationMeta(
    'currentStock',
  );
  @override
  late final GeneratedColumn<double> currentStock = GeneratedColumn<double>(
    'current_stock',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _minStockThresholdMeta = const VerificationMeta(
    'minStockThreshold',
  );
  @override
  late final GeneratedColumn<double> minStockThreshold =
      GeneratedColumn<double>(
        'min_stock_threshold',
        aliasedName,
        false,
        type: DriftSqlType.double,
        requiredDuringInsert: false,
        defaultValue: const Constant(0),
      );
  static const VerificationMeta _costPerUnitMeta = const VerificationMeta(
    'costPerUnit',
  );
  @override
  late final GeneratedColumn<double> costPerUnit = GeneratedColumn<double>(
    'cost_per_unit',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _skuMeta = const VerificationMeta('sku');
  @override
  late final GeneratedColumn<String> sku = GeneratedColumn<String>(
    'sku',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _brandMeta = const VerificationMeta('brand');
  @override
  late final GeneratedColumn<String> brand = GeneratedColumn<String>(
    'brand',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _countryOfOriginMeta = const VerificationMeta(
    'countryOfOrigin',
  );
  @override
  late final GeneratedColumn<String> countryOfOrigin = GeneratedColumn<String>(
    'country_of_origin',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _inciMeta = const VerificationMeta('inci');
  @override
  late final GeneratedColumn<String> inci = GeneratedColumn<String>(
    'inci',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _notificationCodeMeta = const VerificationMeta(
    'notificationCode',
  );
  @override
  late final GeneratedColumn<String> notificationCode = GeneratedColumn<String>(
    'notification_code',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _paoMonthsMeta = const VerificationMeta(
    'paoMonths',
  );
  @override
  late final GeneratedColumn<int> paoMonths = GeneratedColumn<int>(
    'pao_months',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _isCosmeticMeta = const VerificationMeta(
    'isCosmetic',
  );
  @override
  late final GeneratedColumn<bool> isCosmetic = GeneratedColumn<bool>(
    'is_cosmetic',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("is_cosmetic" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  static const VerificationMeta _isActiveMeta = const VerificationMeta(
    'isActive',
  );
  @override
  late final GeneratedColumn<bool> isActive = GeneratedColumn<bool>(
    'is_active',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("is_active" IN (0, 1))',
    ),
    defaultValue: const Constant(true),
  );
  static const VerificationMeta _supplierIdMeta = const VerificationMeta(
    'supplierId',
  );
  @override
  late final GeneratedColumn<String> supplierId = GeneratedColumn<String>(
    'supplier_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _locationIdMeta = const VerificationMeta(
    'locationId',
  );
  @override
  late final GeneratedColumn<String> locationId = GeneratedColumn<String>(
    'location_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    tenantId,
    name,
    unit,
    category,
    currentStock,
    minStockThreshold,
    costPerUnit,
    sku,
    brand,
    countryOfOrigin,
    inci,
    notificationCode,
    paoMonths,
    isCosmetic,
    isActive,
    supplierId,
    locationId,
    createdAt,
    updatedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'materials';
  @override
  VerificationContext validateIntegrity(
    Insertable<Material> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('tenant_id')) {
      context.handle(
        _tenantIdMeta,
        tenantId.isAcceptableOrUnknown(data['tenant_id']!, _tenantIdMeta),
      );
    } else if (isInserting) {
      context.missing(_tenantIdMeta);
    }
    if (data.containsKey('name')) {
      context.handle(
        _nameMeta,
        name.isAcceptableOrUnknown(data['name']!, _nameMeta),
      );
    } else if (isInserting) {
      context.missing(_nameMeta);
    }
    if (data.containsKey('unit')) {
      context.handle(
        _unitMeta,
        unit.isAcceptableOrUnknown(data['unit']!, _unitMeta),
      );
    } else if (isInserting) {
      context.missing(_unitMeta);
    }
    if (data.containsKey('category')) {
      context.handle(
        _categoryMeta,
        category.isAcceptableOrUnknown(data['category']!, _categoryMeta),
      );
    }
    if (data.containsKey('current_stock')) {
      context.handle(
        _currentStockMeta,
        currentStock.isAcceptableOrUnknown(
          data['current_stock']!,
          _currentStockMeta,
        ),
      );
    }
    if (data.containsKey('min_stock_threshold')) {
      context.handle(
        _minStockThresholdMeta,
        minStockThreshold.isAcceptableOrUnknown(
          data['min_stock_threshold']!,
          _minStockThresholdMeta,
        ),
      );
    }
    if (data.containsKey('cost_per_unit')) {
      context.handle(
        _costPerUnitMeta,
        costPerUnit.isAcceptableOrUnknown(
          data['cost_per_unit']!,
          _costPerUnitMeta,
        ),
      );
    }
    if (data.containsKey('sku')) {
      context.handle(
        _skuMeta,
        sku.isAcceptableOrUnknown(data['sku']!, _skuMeta),
      );
    }
    if (data.containsKey('brand')) {
      context.handle(
        _brandMeta,
        brand.isAcceptableOrUnknown(data['brand']!, _brandMeta),
      );
    }
    if (data.containsKey('country_of_origin')) {
      context.handle(
        _countryOfOriginMeta,
        countryOfOrigin.isAcceptableOrUnknown(
          data['country_of_origin']!,
          _countryOfOriginMeta,
        ),
      );
    }
    if (data.containsKey('inci')) {
      context.handle(
        _inciMeta,
        inci.isAcceptableOrUnknown(data['inci']!, _inciMeta),
      );
    }
    if (data.containsKey('notification_code')) {
      context.handle(
        _notificationCodeMeta,
        notificationCode.isAcceptableOrUnknown(
          data['notification_code']!,
          _notificationCodeMeta,
        ),
      );
    }
    if (data.containsKey('pao_months')) {
      context.handle(
        _paoMonthsMeta,
        paoMonths.isAcceptableOrUnknown(data['pao_months']!, _paoMonthsMeta),
      );
    }
    if (data.containsKey('is_cosmetic')) {
      context.handle(
        _isCosmeticMeta,
        isCosmetic.isAcceptableOrUnknown(data['is_cosmetic']!, _isCosmeticMeta),
      );
    }
    if (data.containsKey('is_active')) {
      context.handle(
        _isActiveMeta,
        isActive.isAcceptableOrUnknown(data['is_active']!, _isActiveMeta),
      );
    }
    if (data.containsKey('supplier_id')) {
      context.handle(
        _supplierIdMeta,
        supplierId.isAcceptableOrUnknown(data['supplier_id']!, _supplierIdMeta),
      );
    }
    if (data.containsKey('location_id')) {
      context.handle(
        _locationIdMeta,
        locationId.isAcceptableOrUnknown(data['location_id']!, _locationIdMeta),
      );
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  Material map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return Material(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      tenantId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}tenant_id'],
      )!,
      name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}name'],
      )!,
      unit: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}unit'],
      )!,
      category: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}category'],
      ),
      currentStock: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}current_stock'],
      )!,
      minStockThreshold: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}min_stock_threshold'],
      )!,
      costPerUnit: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}cost_per_unit'],
      ),
      sku: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}sku'],
      ),
      brand: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}brand'],
      ),
      countryOfOrigin: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}country_of_origin'],
      ),
      inci: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}inci'],
      ),
      notificationCode: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}notification_code'],
      ),
      paoMonths: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}pao_months'],
      ),
      isCosmetic: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}is_cosmetic'],
      )!,
      isActive: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}is_active'],
      )!,
      supplierId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}supplier_id'],
      ),
      locationId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}location_id'],
      ),
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $MaterialsTable createAlias(String alias) {
    return $MaterialsTable(attachedDatabase, alias);
  }
}

class Material extends DataClass implements Insertable<Material> {
  final String id;
  final String tenantId;
  final String name;
  final String unit;
  final String? category;

  /// Зеркало серверного кэша остатка. НЕ ИЗМЕНЯТЬ локально:
  /// правда — журнал движений, см. шапку файла.
  final double currentStock;
  final double minStockThreshold;
  final double? costPerUnit;
  final String? sku;
  final String? brand;
  final String? countryOfOrigin;
  final String? inci;

  /// Код нотификации МОЗ. Вводится руками — открытого реестра нет,
  /// автосверку обещать нельзя (записано в аудите ТЗ).
  final String? notificationCode;

  /// Срок после вскрытия, месяцев. Из него сервер считает use_by.
  final int? paoMonths;
  final bool isCosmetic;
  final bool isActive;
  final String? supplierId;
  final String? locationId;
  final DateTime createdAt;
  final DateTime updatedAt;
  const Material({
    required this.id,
    required this.tenantId,
    required this.name,
    required this.unit,
    this.category,
    required this.currentStock,
    required this.minStockThreshold,
    this.costPerUnit,
    this.sku,
    this.brand,
    this.countryOfOrigin,
    this.inci,
    this.notificationCode,
    this.paoMonths,
    required this.isCosmetic,
    required this.isActive,
    this.supplierId,
    this.locationId,
    required this.createdAt,
    required this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['tenant_id'] = Variable<String>(tenantId);
    map['name'] = Variable<String>(name);
    map['unit'] = Variable<String>(unit);
    if (!nullToAbsent || category != null) {
      map['category'] = Variable<String>(category);
    }
    map['current_stock'] = Variable<double>(currentStock);
    map['min_stock_threshold'] = Variable<double>(minStockThreshold);
    if (!nullToAbsent || costPerUnit != null) {
      map['cost_per_unit'] = Variable<double>(costPerUnit);
    }
    if (!nullToAbsent || sku != null) {
      map['sku'] = Variable<String>(sku);
    }
    if (!nullToAbsent || brand != null) {
      map['brand'] = Variable<String>(brand);
    }
    if (!nullToAbsent || countryOfOrigin != null) {
      map['country_of_origin'] = Variable<String>(countryOfOrigin);
    }
    if (!nullToAbsent || inci != null) {
      map['inci'] = Variable<String>(inci);
    }
    if (!nullToAbsent || notificationCode != null) {
      map['notification_code'] = Variable<String>(notificationCode);
    }
    if (!nullToAbsent || paoMonths != null) {
      map['pao_months'] = Variable<int>(paoMonths);
    }
    map['is_cosmetic'] = Variable<bool>(isCosmetic);
    map['is_active'] = Variable<bool>(isActive);
    if (!nullToAbsent || supplierId != null) {
      map['supplier_id'] = Variable<String>(supplierId);
    }
    if (!nullToAbsent || locationId != null) {
      map['location_id'] = Variable<String>(locationId);
    }
    map['created_at'] = Variable<DateTime>(createdAt);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  MaterialsCompanion toCompanion(bool nullToAbsent) {
    return MaterialsCompanion(
      id: Value(id),
      tenantId: Value(tenantId),
      name: Value(name),
      unit: Value(unit),
      category: category == null && nullToAbsent
          ? const Value.absent()
          : Value(category),
      currentStock: Value(currentStock),
      minStockThreshold: Value(minStockThreshold),
      costPerUnit: costPerUnit == null && nullToAbsent
          ? const Value.absent()
          : Value(costPerUnit),
      sku: sku == null && nullToAbsent ? const Value.absent() : Value(sku),
      brand: brand == null && nullToAbsent
          ? const Value.absent()
          : Value(brand),
      countryOfOrigin: countryOfOrigin == null && nullToAbsent
          ? const Value.absent()
          : Value(countryOfOrigin),
      inci: inci == null && nullToAbsent ? const Value.absent() : Value(inci),
      notificationCode: notificationCode == null && nullToAbsent
          ? const Value.absent()
          : Value(notificationCode),
      paoMonths: paoMonths == null && nullToAbsent
          ? const Value.absent()
          : Value(paoMonths),
      isCosmetic: Value(isCosmetic),
      isActive: Value(isActive),
      supplierId: supplierId == null && nullToAbsent
          ? const Value.absent()
          : Value(supplierId),
      locationId: locationId == null && nullToAbsent
          ? const Value.absent()
          : Value(locationId),
      createdAt: Value(createdAt),
      updatedAt: Value(updatedAt),
    );
  }

  factory Material.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return Material(
      id: serializer.fromJson<String>(json['id']),
      tenantId: serializer.fromJson<String>(json['tenantId']),
      name: serializer.fromJson<String>(json['name']),
      unit: serializer.fromJson<String>(json['unit']),
      category: serializer.fromJson<String?>(json['category']),
      currentStock: serializer.fromJson<double>(json['currentStock']),
      minStockThreshold: serializer.fromJson<double>(json['minStockThreshold']),
      costPerUnit: serializer.fromJson<double?>(json['costPerUnit']),
      sku: serializer.fromJson<String?>(json['sku']),
      brand: serializer.fromJson<String?>(json['brand']),
      countryOfOrigin: serializer.fromJson<String?>(json['countryOfOrigin']),
      inci: serializer.fromJson<String?>(json['inci']),
      notificationCode: serializer.fromJson<String?>(json['notificationCode']),
      paoMonths: serializer.fromJson<int?>(json['paoMonths']),
      isCosmetic: serializer.fromJson<bool>(json['isCosmetic']),
      isActive: serializer.fromJson<bool>(json['isActive']),
      supplierId: serializer.fromJson<String?>(json['supplierId']),
      locationId: serializer.fromJson<String?>(json['locationId']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'tenantId': serializer.toJson<String>(tenantId),
      'name': serializer.toJson<String>(name),
      'unit': serializer.toJson<String>(unit),
      'category': serializer.toJson<String?>(category),
      'currentStock': serializer.toJson<double>(currentStock),
      'minStockThreshold': serializer.toJson<double>(minStockThreshold),
      'costPerUnit': serializer.toJson<double?>(costPerUnit),
      'sku': serializer.toJson<String?>(sku),
      'brand': serializer.toJson<String?>(brand),
      'countryOfOrigin': serializer.toJson<String?>(countryOfOrigin),
      'inci': serializer.toJson<String?>(inci),
      'notificationCode': serializer.toJson<String?>(notificationCode),
      'paoMonths': serializer.toJson<int?>(paoMonths),
      'isCosmetic': serializer.toJson<bool>(isCosmetic),
      'isActive': serializer.toJson<bool>(isActive),
      'supplierId': serializer.toJson<String?>(supplierId),
      'locationId': serializer.toJson<String?>(locationId),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  Material copyWith({
    String? id,
    String? tenantId,
    String? name,
    String? unit,
    Value<String?> category = const Value.absent(),
    double? currentStock,
    double? minStockThreshold,
    Value<double?> costPerUnit = const Value.absent(),
    Value<String?> sku = const Value.absent(),
    Value<String?> brand = const Value.absent(),
    Value<String?> countryOfOrigin = const Value.absent(),
    Value<String?> inci = const Value.absent(),
    Value<String?> notificationCode = const Value.absent(),
    Value<int?> paoMonths = const Value.absent(),
    bool? isCosmetic,
    bool? isActive,
    Value<String?> supplierId = const Value.absent(),
    Value<String?> locationId = const Value.absent(),
    DateTime? createdAt,
    DateTime? updatedAt,
  }) => Material(
    id: id ?? this.id,
    tenantId: tenantId ?? this.tenantId,
    name: name ?? this.name,
    unit: unit ?? this.unit,
    category: category.present ? category.value : this.category,
    currentStock: currentStock ?? this.currentStock,
    minStockThreshold: minStockThreshold ?? this.minStockThreshold,
    costPerUnit: costPerUnit.present ? costPerUnit.value : this.costPerUnit,
    sku: sku.present ? sku.value : this.sku,
    brand: brand.present ? brand.value : this.brand,
    countryOfOrigin: countryOfOrigin.present
        ? countryOfOrigin.value
        : this.countryOfOrigin,
    inci: inci.present ? inci.value : this.inci,
    notificationCode: notificationCode.present
        ? notificationCode.value
        : this.notificationCode,
    paoMonths: paoMonths.present ? paoMonths.value : this.paoMonths,
    isCosmetic: isCosmetic ?? this.isCosmetic,
    isActive: isActive ?? this.isActive,
    supplierId: supplierId.present ? supplierId.value : this.supplierId,
    locationId: locationId.present ? locationId.value : this.locationId,
    createdAt: createdAt ?? this.createdAt,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  Material copyWithCompanion(MaterialsCompanion data) {
    return Material(
      id: data.id.present ? data.id.value : this.id,
      tenantId: data.tenantId.present ? data.tenantId.value : this.tenantId,
      name: data.name.present ? data.name.value : this.name,
      unit: data.unit.present ? data.unit.value : this.unit,
      category: data.category.present ? data.category.value : this.category,
      currentStock: data.currentStock.present
          ? data.currentStock.value
          : this.currentStock,
      minStockThreshold: data.minStockThreshold.present
          ? data.minStockThreshold.value
          : this.minStockThreshold,
      costPerUnit: data.costPerUnit.present
          ? data.costPerUnit.value
          : this.costPerUnit,
      sku: data.sku.present ? data.sku.value : this.sku,
      brand: data.brand.present ? data.brand.value : this.brand,
      countryOfOrigin: data.countryOfOrigin.present
          ? data.countryOfOrigin.value
          : this.countryOfOrigin,
      inci: data.inci.present ? data.inci.value : this.inci,
      notificationCode: data.notificationCode.present
          ? data.notificationCode.value
          : this.notificationCode,
      paoMonths: data.paoMonths.present ? data.paoMonths.value : this.paoMonths,
      isCosmetic: data.isCosmetic.present
          ? data.isCosmetic.value
          : this.isCosmetic,
      isActive: data.isActive.present ? data.isActive.value : this.isActive,
      supplierId: data.supplierId.present
          ? data.supplierId.value
          : this.supplierId,
      locationId: data.locationId.present
          ? data.locationId.value
          : this.locationId,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('Material(')
          ..write('id: $id, ')
          ..write('tenantId: $tenantId, ')
          ..write('name: $name, ')
          ..write('unit: $unit, ')
          ..write('category: $category, ')
          ..write('currentStock: $currentStock, ')
          ..write('minStockThreshold: $minStockThreshold, ')
          ..write('costPerUnit: $costPerUnit, ')
          ..write('sku: $sku, ')
          ..write('brand: $brand, ')
          ..write('countryOfOrigin: $countryOfOrigin, ')
          ..write('inci: $inci, ')
          ..write('notificationCode: $notificationCode, ')
          ..write('paoMonths: $paoMonths, ')
          ..write('isCosmetic: $isCosmetic, ')
          ..write('isActive: $isActive, ')
          ..write('supplierId: $supplierId, ')
          ..write('locationId: $locationId, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    tenantId,
    name,
    unit,
    category,
    currentStock,
    minStockThreshold,
    costPerUnit,
    sku,
    brand,
    countryOfOrigin,
    inci,
    notificationCode,
    paoMonths,
    isCosmetic,
    isActive,
    supplierId,
    locationId,
    createdAt,
    updatedAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is Material &&
          other.id == this.id &&
          other.tenantId == this.tenantId &&
          other.name == this.name &&
          other.unit == this.unit &&
          other.category == this.category &&
          other.currentStock == this.currentStock &&
          other.minStockThreshold == this.minStockThreshold &&
          other.costPerUnit == this.costPerUnit &&
          other.sku == this.sku &&
          other.brand == this.brand &&
          other.countryOfOrigin == this.countryOfOrigin &&
          other.inci == this.inci &&
          other.notificationCode == this.notificationCode &&
          other.paoMonths == this.paoMonths &&
          other.isCosmetic == this.isCosmetic &&
          other.isActive == this.isActive &&
          other.supplierId == this.supplierId &&
          other.locationId == this.locationId &&
          other.createdAt == this.createdAt &&
          other.updatedAt == this.updatedAt);
}

class MaterialsCompanion extends UpdateCompanion<Material> {
  final Value<String> id;
  final Value<String> tenantId;
  final Value<String> name;
  final Value<String> unit;
  final Value<String?> category;
  final Value<double> currentStock;
  final Value<double> minStockThreshold;
  final Value<double?> costPerUnit;
  final Value<String?> sku;
  final Value<String?> brand;
  final Value<String?> countryOfOrigin;
  final Value<String?> inci;
  final Value<String?> notificationCode;
  final Value<int?> paoMonths;
  final Value<bool> isCosmetic;
  final Value<bool> isActive;
  final Value<String?> supplierId;
  final Value<String?> locationId;
  final Value<DateTime> createdAt;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const MaterialsCompanion({
    this.id = const Value.absent(),
    this.tenantId = const Value.absent(),
    this.name = const Value.absent(),
    this.unit = const Value.absent(),
    this.category = const Value.absent(),
    this.currentStock = const Value.absent(),
    this.minStockThreshold = const Value.absent(),
    this.costPerUnit = const Value.absent(),
    this.sku = const Value.absent(),
    this.brand = const Value.absent(),
    this.countryOfOrigin = const Value.absent(),
    this.inci = const Value.absent(),
    this.notificationCode = const Value.absent(),
    this.paoMonths = const Value.absent(),
    this.isCosmetic = const Value.absent(),
    this.isActive = const Value.absent(),
    this.supplierId = const Value.absent(),
    this.locationId = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  MaterialsCompanion.insert({
    required String id,
    required String tenantId,
    required String name,
    required String unit,
    this.category = const Value.absent(),
    this.currentStock = const Value.absent(),
    this.minStockThreshold = const Value.absent(),
    this.costPerUnit = const Value.absent(),
    this.sku = const Value.absent(),
    this.brand = const Value.absent(),
    this.countryOfOrigin = const Value.absent(),
    this.inci = const Value.absent(),
    this.notificationCode = const Value.absent(),
    this.paoMonths = const Value.absent(),
    this.isCosmetic = const Value.absent(),
    this.isActive = const Value.absent(),
    this.supplierId = const Value.absent(),
    this.locationId = const Value.absent(),
    required DateTime createdAt,
    required DateTime updatedAt,
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       tenantId = Value(tenantId),
       name = Value(name),
       unit = Value(unit),
       createdAt = Value(createdAt),
       updatedAt = Value(updatedAt);
  static Insertable<Material> custom({
    Expression<String>? id,
    Expression<String>? tenantId,
    Expression<String>? name,
    Expression<String>? unit,
    Expression<String>? category,
    Expression<double>? currentStock,
    Expression<double>? minStockThreshold,
    Expression<double>? costPerUnit,
    Expression<String>? sku,
    Expression<String>? brand,
    Expression<String>? countryOfOrigin,
    Expression<String>? inci,
    Expression<String>? notificationCode,
    Expression<int>? paoMonths,
    Expression<bool>? isCosmetic,
    Expression<bool>? isActive,
    Expression<String>? supplierId,
    Expression<String>? locationId,
    Expression<DateTime>? createdAt,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (tenantId != null) 'tenant_id': tenantId,
      if (name != null) 'name': name,
      if (unit != null) 'unit': unit,
      if (category != null) 'category': category,
      if (currentStock != null) 'current_stock': currentStock,
      if (minStockThreshold != null) 'min_stock_threshold': minStockThreshold,
      if (costPerUnit != null) 'cost_per_unit': costPerUnit,
      if (sku != null) 'sku': sku,
      if (brand != null) 'brand': brand,
      if (countryOfOrigin != null) 'country_of_origin': countryOfOrigin,
      if (inci != null) 'inci': inci,
      if (notificationCode != null) 'notification_code': notificationCode,
      if (paoMonths != null) 'pao_months': paoMonths,
      if (isCosmetic != null) 'is_cosmetic': isCosmetic,
      if (isActive != null) 'is_active': isActive,
      if (supplierId != null) 'supplier_id': supplierId,
      if (locationId != null) 'location_id': locationId,
      if (createdAt != null) 'created_at': createdAt,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  MaterialsCompanion copyWith({
    Value<String>? id,
    Value<String>? tenantId,
    Value<String>? name,
    Value<String>? unit,
    Value<String?>? category,
    Value<double>? currentStock,
    Value<double>? minStockThreshold,
    Value<double?>? costPerUnit,
    Value<String?>? sku,
    Value<String?>? brand,
    Value<String?>? countryOfOrigin,
    Value<String?>? inci,
    Value<String?>? notificationCode,
    Value<int?>? paoMonths,
    Value<bool>? isCosmetic,
    Value<bool>? isActive,
    Value<String?>? supplierId,
    Value<String?>? locationId,
    Value<DateTime>? createdAt,
    Value<DateTime>? updatedAt,
    Value<int>? rowid,
  }) {
    return MaterialsCompanion(
      id: id ?? this.id,
      tenantId: tenantId ?? this.tenantId,
      name: name ?? this.name,
      unit: unit ?? this.unit,
      category: category ?? this.category,
      currentStock: currentStock ?? this.currentStock,
      minStockThreshold: minStockThreshold ?? this.minStockThreshold,
      costPerUnit: costPerUnit ?? this.costPerUnit,
      sku: sku ?? this.sku,
      brand: brand ?? this.brand,
      countryOfOrigin: countryOfOrigin ?? this.countryOfOrigin,
      inci: inci ?? this.inci,
      notificationCode: notificationCode ?? this.notificationCode,
      paoMonths: paoMonths ?? this.paoMonths,
      isCosmetic: isCosmetic ?? this.isCosmetic,
      isActive: isActive ?? this.isActive,
      supplierId: supplierId ?? this.supplierId,
      locationId: locationId ?? this.locationId,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (tenantId.present) {
      map['tenant_id'] = Variable<String>(tenantId.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (unit.present) {
      map['unit'] = Variable<String>(unit.value);
    }
    if (category.present) {
      map['category'] = Variable<String>(category.value);
    }
    if (currentStock.present) {
      map['current_stock'] = Variable<double>(currentStock.value);
    }
    if (minStockThreshold.present) {
      map['min_stock_threshold'] = Variable<double>(minStockThreshold.value);
    }
    if (costPerUnit.present) {
      map['cost_per_unit'] = Variable<double>(costPerUnit.value);
    }
    if (sku.present) {
      map['sku'] = Variable<String>(sku.value);
    }
    if (brand.present) {
      map['brand'] = Variable<String>(brand.value);
    }
    if (countryOfOrigin.present) {
      map['country_of_origin'] = Variable<String>(countryOfOrigin.value);
    }
    if (inci.present) {
      map['inci'] = Variable<String>(inci.value);
    }
    if (notificationCode.present) {
      map['notification_code'] = Variable<String>(notificationCode.value);
    }
    if (paoMonths.present) {
      map['pao_months'] = Variable<int>(paoMonths.value);
    }
    if (isCosmetic.present) {
      map['is_cosmetic'] = Variable<bool>(isCosmetic.value);
    }
    if (isActive.present) {
      map['is_active'] = Variable<bool>(isActive.value);
    }
    if (supplierId.present) {
      map['supplier_id'] = Variable<String>(supplierId.value);
    }
    if (locationId.present) {
      map['location_id'] = Variable<String>(locationId.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('MaterialsCompanion(')
          ..write('id: $id, ')
          ..write('tenantId: $tenantId, ')
          ..write('name: $name, ')
          ..write('unit: $unit, ')
          ..write('category: $category, ')
          ..write('currentStock: $currentStock, ')
          ..write('minStockThreshold: $minStockThreshold, ')
          ..write('costPerUnit: $costPerUnit, ')
          ..write('sku: $sku, ')
          ..write('brand: $brand, ')
          ..write('countryOfOrigin: $countryOfOrigin, ')
          ..write('inci: $inci, ')
          ..write('notificationCode: $notificationCode, ')
          ..write('paoMonths: $paoMonths, ')
          ..write('isCosmetic: $isCosmetic, ')
          ..write('isActive: $isActive, ')
          ..write('supplierId: $supplierId, ')
          ..write('locationId: $locationId, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $MaterialBatchesTable extends MaterialBatches
    with TableInfo<$MaterialBatchesTable, MaterialBatche> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $MaterialBatchesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _tenantIdMeta = const VerificationMeta(
    'tenantId',
  );
  @override
  late final GeneratedColumn<String> tenantId = GeneratedColumn<String>(
    'tenant_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _materialIdMeta = const VerificationMeta(
    'materialId',
  );
  @override
  late final GeneratedColumn<String> materialId = GeneratedColumn<String>(
    'material_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _batchNumberMeta = const VerificationMeta(
    'batchNumber',
  );
  @override
  late final GeneratedColumn<String> batchNumber = GeneratedColumn<String>(
    'batch_number',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _expiryDateMeta = const VerificationMeta(
    'expiryDate',
  );
  @override
  late final GeneratedColumn<String> expiryDate = GeneratedColumn<String>(
    'expiry_date',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _receivedAtMeta = const VerificationMeta(
    'receivedAt',
  );
  @override
  late final GeneratedColumn<String> receivedAt = GeneratedColumn<String>(
    'received_at',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _supplierIdMeta = const VerificationMeta(
    'supplierId',
  );
  @override
  late final GeneratedColumn<String> supplierId = GeneratedColumn<String>(
    'supplier_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _noteMeta = const VerificationMeta('note');
  @override
  late final GeneratedColumn<String> note = GeneratedColumn<String>(
    'note',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _createdByMeta = const VerificationMeta(
    'createdBy',
  );
  @override
  late final GeneratedColumn<String> createdBy = GeneratedColumn<String>(
    'created_by',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    tenantId,
    materialId,
    batchNumber,
    expiryDate,
    receivedAt,
    supplierId,
    note,
    createdBy,
    createdAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'material_batches';
  @override
  VerificationContext validateIntegrity(
    Insertable<MaterialBatche> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('tenant_id')) {
      context.handle(
        _tenantIdMeta,
        tenantId.isAcceptableOrUnknown(data['tenant_id']!, _tenantIdMeta),
      );
    } else if (isInserting) {
      context.missing(_tenantIdMeta);
    }
    if (data.containsKey('material_id')) {
      context.handle(
        _materialIdMeta,
        materialId.isAcceptableOrUnknown(data['material_id']!, _materialIdMeta),
      );
    } else if (isInserting) {
      context.missing(_materialIdMeta);
    }
    if (data.containsKey('batch_number')) {
      context.handle(
        _batchNumberMeta,
        batchNumber.isAcceptableOrUnknown(
          data['batch_number']!,
          _batchNumberMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_batchNumberMeta);
    }
    if (data.containsKey('expiry_date')) {
      context.handle(
        _expiryDateMeta,
        expiryDate.isAcceptableOrUnknown(data['expiry_date']!, _expiryDateMeta),
      );
    } else if (isInserting) {
      context.missing(_expiryDateMeta);
    }
    if (data.containsKey('received_at')) {
      context.handle(
        _receivedAtMeta,
        receivedAt.isAcceptableOrUnknown(data['received_at']!, _receivedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_receivedAtMeta);
    }
    if (data.containsKey('supplier_id')) {
      context.handle(
        _supplierIdMeta,
        supplierId.isAcceptableOrUnknown(data['supplier_id']!, _supplierIdMeta),
      );
    }
    if (data.containsKey('note')) {
      context.handle(
        _noteMeta,
        note.isAcceptableOrUnknown(data['note']!, _noteMeta),
      );
    }
    if (data.containsKey('created_by')) {
      context.handle(
        _createdByMeta,
        createdBy.isAcceptableOrUnknown(data['created_by']!, _createdByMeta),
      );
    } else if (isInserting) {
      context.missing(_createdByMeta);
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  MaterialBatche map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return MaterialBatche(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      tenantId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}tenant_id'],
      )!,
      materialId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}material_id'],
      )!,
      batchNumber: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}batch_number'],
      )!,
      expiryDate: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}expiry_date'],
      )!,
      receivedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}received_at'],
      )!,
      supplierId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}supplier_id'],
      ),
      note: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}note'],
      ),
      createdBy: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}created_by'],
      )!,
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
    );
  }

  @override
  $MaterialBatchesTable createAlias(String alias) {
    return $MaterialBatchesTable(attachedDatabase, alias);
  }
}

class MaterialBatche extends DataClass implements Insertable<MaterialBatche> {
  final String id;
  final String tenantId;
  final String materialId;
  final String batchNumber;

  /// YYYY-MM-DD, см. шапку про даты.
  final String expiryDate;
  final String receivedAt;
  final String? supplierId;
  final String? note;
  final String createdBy;
  final DateTime createdAt;
  const MaterialBatche({
    required this.id,
    required this.tenantId,
    required this.materialId,
    required this.batchNumber,
    required this.expiryDate,
    required this.receivedAt,
    this.supplierId,
    this.note,
    required this.createdBy,
    required this.createdAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['tenant_id'] = Variable<String>(tenantId);
    map['material_id'] = Variable<String>(materialId);
    map['batch_number'] = Variable<String>(batchNumber);
    map['expiry_date'] = Variable<String>(expiryDate);
    map['received_at'] = Variable<String>(receivedAt);
    if (!nullToAbsent || supplierId != null) {
      map['supplier_id'] = Variable<String>(supplierId);
    }
    if (!nullToAbsent || note != null) {
      map['note'] = Variable<String>(note);
    }
    map['created_by'] = Variable<String>(createdBy);
    map['created_at'] = Variable<DateTime>(createdAt);
    return map;
  }

  MaterialBatchesCompanion toCompanion(bool nullToAbsent) {
    return MaterialBatchesCompanion(
      id: Value(id),
      tenantId: Value(tenantId),
      materialId: Value(materialId),
      batchNumber: Value(batchNumber),
      expiryDate: Value(expiryDate),
      receivedAt: Value(receivedAt),
      supplierId: supplierId == null && nullToAbsent
          ? const Value.absent()
          : Value(supplierId),
      note: note == null && nullToAbsent ? const Value.absent() : Value(note),
      createdBy: Value(createdBy),
      createdAt: Value(createdAt),
    );
  }

  factory MaterialBatche.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return MaterialBatche(
      id: serializer.fromJson<String>(json['id']),
      tenantId: serializer.fromJson<String>(json['tenantId']),
      materialId: serializer.fromJson<String>(json['materialId']),
      batchNumber: serializer.fromJson<String>(json['batchNumber']),
      expiryDate: serializer.fromJson<String>(json['expiryDate']),
      receivedAt: serializer.fromJson<String>(json['receivedAt']),
      supplierId: serializer.fromJson<String?>(json['supplierId']),
      note: serializer.fromJson<String?>(json['note']),
      createdBy: serializer.fromJson<String>(json['createdBy']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'tenantId': serializer.toJson<String>(tenantId),
      'materialId': serializer.toJson<String>(materialId),
      'batchNumber': serializer.toJson<String>(batchNumber),
      'expiryDate': serializer.toJson<String>(expiryDate),
      'receivedAt': serializer.toJson<String>(receivedAt),
      'supplierId': serializer.toJson<String?>(supplierId),
      'note': serializer.toJson<String?>(note),
      'createdBy': serializer.toJson<String>(createdBy),
      'createdAt': serializer.toJson<DateTime>(createdAt),
    };
  }

  MaterialBatche copyWith({
    String? id,
    String? tenantId,
    String? materialId,
    String? batchNumber,
    String? expiryDate,
    String? receivedAt,
    Value<String?> supplierId = const Value.absent(),
    Value<String?> note = const Value.absent(),
    String? createdBy,
    DateTime? createdAt,
  }) => MaterialBatche(
    id: id ?? this.id,
    tenantId: tenantId ?? this.tenantId,
    materialId: materialId ?? this.materialId,
    batchNumber: batchNumber ?? this.batchNumber,
    expiryDate: expiryDate ?? this.expiryDate,
    receivedAt: receivedAt ?? this.receivedAt,
    supplierId: supplierId.present ? supplierId.value : this.supplierId,
    note: note.present ? note.value : this.note,
    createdBy: createdBy ?? this.createdBy,
    createdAt: createdAt ?? this.createdAt,
  );
  MaterialBatche copyWithCompanion(MaterialBatchesCompanion data) {
    return MaterialBatche(
      id: data.id.present ? data.id.value : this.id,
      tenantId: data.tenantId.present ? data.tenantId.value : this.tenantId,
      materialId: data.materialId.present
          ? data.materialId.value
          : this.materialId,
      batchNumber: data.batchNumber.present
          ? data.batchNumber.value
          : this.batchNumber,
      expiryDate: data.expiryDate.present
          ? data.expiryDate.value
          : this.expiryDate,
      receivedAt: data.receivedAt.present
          ? data.receivedAt.value
          : this.receivedAt,
      supplierId: data.supplierId.present
          ? data.supplierId.value
          : this.supplierId,
      note: data.note.present ? data.note.value : this.note,
      createdBy: data.createdBy.present ? data.createdBy.value : this.createdBy,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('MaterialBatche(')
          ..write('id: $id, ')
          ..write('tenantId: $tenantId, ')
          ..write('materialId: $materialId, ')
          ..write('batchNumber: $batchNumber, ')
          ..write('expiryDate: $expiryDate, ')
          ..write('receivedAt: $receivedAt, ')
          ..write('supplierId: $supplierId, ')
          ..write('note: $note, ')
          ..write('createdBy: $createdBy, ')
          ..write('createdAt: $createdAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    tenantId,
    materialId,
    batchNumber,
    expiryDate,
    receivedAt,
    supplierId,
    note,
    createdBy,
    createdAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is MaterialBatche &&
          other.id == this.id &&
          other.tenantId == this.tenantId &&
          other.materialId == this.materialId &&
          other.batchNumber == this.batchNumber &&
          other.expiryDate == this.expiryDate &&
          other.receivedAt == this.receivedAt &&
          other.supplierId == this.supplierId &&
          other.note == this.note &&
          other.createdBy == this.createdBy &&
          other.createdAt == this.createdAt);
}

class MaterialBatchesCompanion extends UpdateCompanion<MaterialBatche> {
  final Value<String> id;
  final Value<String> tenantId;
  final Value<String> materialId;
  final Value<String> batchNumber;
  final Value<String> expiryDate;
  final Value<String> receivedAt;
  final Value<String?> supplierId;
  final Value<String?> note;
  final Value<String> createdBy;
  final Value<DateTime> createdAt;
  final Value<int> rowid;
  const MaterialBatchesCompanion({
    this.id = const Value.absent(),
    this.tenantId = const Value.absent(),
    this.materialId = const Value.absent(),
    this.batchNumber = const Value.absent(),
    this.expiryDate = const Value.absent(),
    this.receivedAt = const Value.absent(),
    this.supplierId = const Value.absent(),
    this.note = const Value.absent(),
    this.createdBy = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  MaterialBatchesCompanion.insert({
    required String id,
    required String tenantId,
    required String materialId,
    required String batchNumber,
    required String expiryDate,
    required String receivedAt,
    this.supplierId = const Value.absent(),
    this.note = const Value.absent(),
    required String createdBy,
    required DateTime createdAt,
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       tenantId = Value(tenantId),
       materialId = Value(materialId),
       batchNumber = Value(batchNumber),
       expiryDate = Value(expiryDate),
       receivedAt = Value(receivedAt),
       createdBy = Value(createdBy),
       createdAt = Value(createdAt);
  static Insertable<MaterialBatche> custom({
    Expression<String>? id,
    Expression<String>? tenantId,
    Expression<String>? materialId,
    Expression<String>? batchNumber,
    Expression<String>? expiryDate,
    Expression<String>? receivedAt,
    Expression<String>? supplierId,
    Expression<String>? note,
    Expression<String>? createdBy,
    Expression<DateTime>? createdAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (tenantId != null) 'tenant_id': tenantId,
      if (materialId != null) 'material_id': materialId,
      if (batchNumber != null) 'batch_number': batchNumber,
      if (expiryDate != null) 'expiry_date': expiryDate,
      if (receivedAt != null) 'received_at': receivedAt,
      if (supplierId != null) 'supplier_id': supplierId,
      if (note != null) 'note': note,
      if (createdBy != null) 'created_by': createdBy,
      if (createdAt != null) 'created_at': createdAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  MaterialBatchesCompanion copyWith({
    Value<String>? id,
    Value<String>? tenantId,
    Value<String>? materialId,
    Value<String>? batchNumber,
    Value<String>? expiryDate,
    Value<String>? receivedAt,
    Value<String?>? supplierId,
    Value<String?>? note,
    Value<String>? createdBy,
    Value<DateTime>? createdAt,
    Value<int>? rowid,
  }) {
    return MaterialBatchesCompanion(
      id: id ?? this.id,
      tenantId: tenantId ?? this.tenantId,
      materialId: materialId ?? this.materialId,
      batchNumber: batchNumber ?? this.batchNumber,
      expiryDate: expiryDate ?? this.expiryDate,
      receivedAt: receivedAt ?? this.receivedAt,
      supplierId: supplierId ?? this.supplierId,
      note: note ?? this.note,
      createdBy: createdBy ?? this.createdBy,
      createdAt: createdAt ?? this.createdAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (tenantId.present) {
      map['tenant_id'] = Variable<String>(tenantId.value);
    }
    if (materialId.present) {
      map['material_id'] = Variable<String>(materialId.value);
    }
    if (batchNumber.present) {
      map['batch_number'] = Variable<String>(batchNumber.value);
    }
    if (expiryDate.present) {
      map['expiry_date'] = Variable<String>(expiryDate.value);
    }
    if (receivedAt.present) {
      map['received_at'] = Variable<String>(receivedAt.value);
    }
    if (supplierId.present) {
      map['supplier_id'] = Variable<String>(supplierId.value);
    }
    if (note.present) {
      map['note'] = Variable<String>(note.value);
    }
    if (createdBy.present) {
      map['created_by'] = Variable<String>(createdBy.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('MaterialBatchesCompanion(')
          ..write('id: $id, ')
          ..write('tenantId: $tenantId, ')
          ..write('materialId: $materialId, ')
          ..write('batchNumber: $batchNumber, ')
          ..write('expiryDate: $expiryDate, ')
          ..write('receivedAt: $receivedAt, ')
          ..write('supplierId: $supplierId, ')
          ..write('note: $note, ')
          ..write('createdBy: $createdBy, ')
          ..write('createdAt: $createdAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $MaterialContainersTable extends MaterialContainers
    with TableInfo<$MaterialContainersTable, MaterialContainer> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $MaterialContainersTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _tenantIdMeta = const VerificationMeta(
    'tenantId',
  );
  @override
  late final GeneratedColumn<String> tenantId = GeneratedColumn<String>(
    'tenant_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _materialIdMeta = const VerificationMeta(
    'materialId',
  );
  @override
  late final GeneratedColumn<String> materialId = GeneratedColumn<String>(
    'material_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _batchIdMeta = const VerificationMeta(
    'batchId',
  );
  @override
  late final GeneratedColumn<String> batchId = GeneratedColumn<String>(
    'batch_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _codeMeta = const VerificationMeta('code');
  @override
  late final GeneratedColumn<String> code = GeneratedColumn<String>(
    'code',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _parentIdMeta = const VerificationMeta(
    'parentId',
  );
  @override
  late final GeneratedColumn<String> parentId = GeneratedColumn<String>(
    'parent_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _volumeMeta = const VerificationMeta('volume');
  @override
  late final GeneratedColumn<double> volume = GeneratedColumn<double>(
    'volume',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _unitMeta = const VerificationMeta('unit');
  @override
  late final GeneratedColumn<String> unit = GeneratedColumn<String>(
    'unit',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
    'status',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _openedAtMeta = const VerificationMeta(
    'openedAt',
  );
  @override
  late final GeneratedColumn<DateTime> openedAt = GeneratedColumn<DateTime>(
    'opened_at',
    aliasedName,
    true,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _openedByMeta = const VerificationMeta(
    'openedBy',
  );
  @override
  late final GeneratedColumn<String> openedBy = GeneratedColumn<String>(
    'opened_by',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _paoMonthsMeta = const VerificationMeta(
    'paoMonths',
  );
  @override
  late final GeneratedColumn<int> paoMonths = GeneratedColumn<int>(
    'pao_months',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _useByMeta = const VerificationMeta('useBy');
  @override
  late final GeneratedColumn<String> useBy = GeneratedColumn<String>(
    'use_by',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _disposedAtMeta = const VerificationMeta(
    'disposedAt',
  );
  @override
  late final GeneratedColumn<DateTime> disposedAt = GeneratedColumn<DateTime>(
    'disposed_at',
    aliasedName,
    true,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _disposedByMeta = const VerificationMeta(
    'disposedBy',
  );
  @override
  late final GeneratedColumn<String> disposedBy = GeneratedColumn<String>(
    'disposed_by',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _noteMeta = const VerificationMeta('note');
  @override
  late final GeneratedColumn<String> note = GeneratedColumn<String>(
    'note',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _createdByMeta = const VerificationMeta(
    'createdBy',
  );
  @override
  late final GeneratedColumn<String> createdBy = GeneratedColumn<String>(
    'created_by',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    tenantId,
    materialId,
    batchId,
    code,
    parentId,
    volume,
    unit,
    status,
    openedAt,
    openedBy,
    paoMonths,
    useBy,
    disposedAt,
    disposedBy,
    note,
    createdBy,
    createdAt,
    updatedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'material_containers';
  @override
  VerificationContext validateIntegrity(
    Insertable<MaterialContainer> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('tenant_id')) {
      context.handle(
        _tenantIdMeta,
        tenantId.isAcceptableOrUnknown(data['tenant_id']!, _tenantIdMeta),
      );
    } else if (isInserting) {
      context.missing(_tenantIdMeta);
    }
    if (data.containsKey('material_id')) {
      context.handle(
        _materialIdMeta,
        materialId.isAcceptableOrUnknown(data['material_id']!, _materialIdMeta),
      );
    } else if (isInserting) {
      context.missing(_materialIdMeta);
    }
    if (data.containsKey('batch_id')) {
      context.handle(
        _batchIdMeta,
        batchId.isAcceptableOrUnknown(data['batch_id']!, _batchIdMeta),
      );
    }
    if (data.containsKey('code')) {
      context.handle(
        _codeMeta,
        code.isAcceptableOrUnknown(data['code']!, _codeMeta),
      );
    } else if (isInserting) {
      context.missing(_codeMeta);
    }
    if (data.containsKey('parent_id')) {
      context.handle(
        _parentIdMeta,
        parentId.isAcceptableOrUnknown(data['parent_id']!, _parentIdMeta),
      );
    }
    if (data.containsKey('volume')) {
      context.handle(
        _volumeMeta,
        volume.isAcceptableOrUnknown(data['volume']!, _volumeMeta),
      );
    }
    if (data.containsKey('unit')) {
      context.handle(
        _unitMeta,
        unit.isAcceptableOrUnknown(data['unit']!, _unitMeta),
      );
    }
    if (data.containsKey('status')) {
      context.handle(
        _statusMeta,
        status.isAcceptableOrUnknown(data['status']!, _statusMeta),
      );
    } else if (isInserting) {
      context.missing(_statusMeta);
    }
    if (data.containsKey('opened_at')) {
      context.handle(
        _openedAtMeta,
        openedAt.isAcceptableOrUnknown(data['opened_at']!, _openedAtMeta),
      );
    }
    if (data.containsKey('opened_by')) {
      context.handle(
        _openedByMeta,
        openedBy.isAcceptableOrUnknown(data['opened_by']!, _openedByMeta),
      );
    }
    if (data.containsKey('pao_months')) {
      context.handle(
        _paoMonthsMeta,
        paoMonths.isAcceptableOrUnknown(data['pao_months']!, _paoMonthsMeta),
      );
    }
    if (data.containsKey('use_by')) {
      context.handle(
        _useByMeta,
        useBy.isAcceptableOrUnknown(data['use_by']!, _useByMeta),
      );
    }
    if (data.containsKey('disposed_at')) {
      context.handle(
        _disposedAtMeta,
        disposedAt.isAcceptableOrUnknown(data['disposed_at']!, _disposedAtMeta),
      );
    }
    if (data.containsKey('disposed_by')) {
      context.handle(
        _disposedByMeta,
        disposedBy.isAcceptableOrUnknown(data['disposed_by']!, _disposedByMeta),
      );
    }
    if (data.containsKey('note')) {
      context.handle(
        _noteMeta,
        note.isAcceptableOrUnknown(data['note']!, _noteMeta),
      );
    }
    if (data.containsKey('created_by')) {
      context.handle(
        _createdByMeta,
        createdBy.isAcceptableOrUnknown(data['created_by']!, _createdByMeta),
      );
    } else if (isInserting) {
      context.missing(_createdByMeta);
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  MaterialContainer map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return MaterialContainer(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      tenantId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}tenant_id'],
      )!,
      materialId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}material_id'],
      )!,
      batchId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}batch_id'],
      ),
      code: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}code'],
      )!,
      parentId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}parent_id'],
      ),
      volume: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}volume'],
      ),
      unit: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}unit'],
      ),
      status: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}status'],
      )!,
      openedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}opened_at'],
      ),
      openedBy: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}opened_by'],
      ),
      paoMonths: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}pao_months'],
      ),
      useBy: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}use_by'],
      ),
      disposedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}disposed_at'],
      ),
      disposedBy: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}disposed_by'],
      ),
      note: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}note'],
      ),
      createdBy: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}created_by'],
      )!,
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $MaterialContainersTable createAlias(String alias) {
    return $MaterialContainersTable(attachedDatabase, alias);
  }
}

class MaterialContainer extends DataClass
    implements Insertable<MaterialContainer> {
  final String id;
  final String tenantId;
  final String materialId;
  final String? batchId;

  /// Код с QR-наклейки — по нему ищет сканер.
  final String code;
  final String? parentId;
  final double? volume;
  final String? unit;

  /// enum на сервере: sealed / opened / finished / disposed.
  /// Хранится строкой — значения приходят из базы как есть.
  final String status;
  final DateTime? openedAt;
  final String? openedBy;
  final int? paoMonths;

  /// YYYY-MM-DD. Считается сервером, локально только читается.
  final String? useBy;
  final DateTime? disposedAt;
  final String? disposedBy;
  final String? note;
  final String createdBy;
  final DateTime createdAt;
  final DateTime updatedAt;
  const MaterialContainer({
    required this.id,
    required this.tenantId,
    required this.materialId,
    this.batchId,
    required this.code,
    this.parentId,
    this.volume,
    this.unit,
    required this.status,
    this.openedAt,
    this.openedBy,
    this.paoMonths,
    this.useBy,
    this.disposedAt,
    this.disposedBy,
    this.note,
    required this.createdBy,
    required this.createdAt,
    required this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['tenant_id'] = Variable<String>(tenantId);
    map['material_id'] = Variable<String>(materialId);
    if (!nullToAbsent || batchId != null) {
      map['batch_id'] = Variable<String>(batchId);
    }
    map['code'] = Variable<String>(code);
    if (!nullToAbsent || parentId != null) {
      map['parent_id'] = Variable<String>(parentId);
    }
    if (!nullToAbsent || volume != null) {
      map['volume'] = Variable<double>(volume);
    }
    if (!nullToAbsent || unit != null) {
      map['unit'] = Variable<String>(unit);
    }
    map['status'] = Variable<String>(status);
    if (!nullToAbsent || openedAt != null) {
      map['opened_at'] = Variable<DateTime>(openedAt);
    }
    if (!nullToAbsent || openedBy != null) {
      map['opened_by'] = Variable<String>(openedBy);
    }
    if (!nullToAbsent || paoMonths != null) {
      map['pao_months'] = Variable<int>(paoMonths);
    }
    if (!nullToAbsent || useBy != null) {
      map['use_by'] = Variable<String>(useBy);
    }
    if (!nullToAbsent || disposedAt != null) {
      map['disposed_at'] = Variable<DateTime>(disposedAt);
    }
    if (!nullToAbsent || disposedBy != null) {
      map['disposed_by'] = Variable<String>(disposedBy);
    }
    if (!nullToAbsent || note != null) {
      map['note'] = Variable<String>(note);
    }
    map['created_by'] = Variable<String>(createdBy);
    map['created_at'] = Variable<DateTime>(createdAt);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  MaterialContainersCompanion toCompanion(bool nullToAbsent) {
    return MaterialContainersCompanion(
      id: Value(id),
      tenantId: Value(tenantId),
      materialId: Value(materialId),
      batchId: batchId == null && nullToAbsent
          ? const Value.absent()
          : Value(batchId),
      code: Value(code),
      parentId: parentId == null && nullToAbsent
          ? const Value.absent()
          : Value(parentId),
      volume: volume == null && nullToAbsent
          ? const Value.absent()
          : Value(volume),
      unit: unit == null && nullToAbsent ? const Value.absent() : Value(unit),
      status: Value(status),
      openedAt: openedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(openedAt),
      openedBy: openedBy == null && nullToAbsent
          ? const Value.absent()
          : Value(openedBy),
      paoMonths: paoMonths == null && nullToAbsent
          ? const Value.absent()
          : Value(paoMonths),
      useBy: useBy == null && nullToAbsent
          ? const Value.absent()
          : Value(useBy),
      disposedAt: disposedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(disposedAt),
      disposedBy: disposedBy == null && nullToAbsent
          ? const Value.absent()
          : Value(disposedBy),
      note: note == null && nullToAbsent ? const Value.absent() : Value(note),
      createdBy: Value(createdBy),
      createdAt: Value(createdAt),
      updatedAt: Value(updatedAt),
    );
  }

  factory MaterialContainer.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return MaterialContainer(
      id: serializer.fromJson<String>(json['id']),
      tenantId: serializer.fromJson<String>(json['tenantId']),
      materialId: serializer.fromJson<String>(json['materialId']),
      batchId: serializer.fromJson<String?>(json['batchId']),
      code: serializer.fromJson<String>(json['code']),
      parentId: serializer.fromJson<String?>(json['parentId']),
      volume: serializer.fromJson<double?>(json['volume']),
      unit: serializer.fromJson<String?>(json['unit']),
      status: serializer.fromJson<String>(json['status']),
      openedAt: serializer.fromJson<DateTime?>(json['openedAt']),
      openedBy: serializer.fromJson<String?>(json['openedBy']),
      paoMonths: serializer.fromJson<int?>(json['paoMonths']),
      useBy: serializer.fromJson<String?>(json['useBy']),
      disposedAt: serializer.fromJson<DateTime?>(json['disposedAt']),
      disposedBy: serializer.fromJson<String?>(json['disposedBy']),
      note: serializer.fromJson<String?>(json['note']),
      createdBy: serializer.fromJson<String>(json['createdBy']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'tenantId': serializer.toJson<String>(tenantId),
      'materialId': serializer.toJson<String>(materialId),
      'batchId': serializer.toJson<String?>(batchId),
      'code': serializer.toJson<String>(code),
      'parentId': serializer.toJson<String?>(parentId),
      'volume': serializer.toJson<double?>(volume),
      'unit': serializer.toJson<String?>(unit),
      'status': serializer.toJson<String>(status),
      'openedAt': serializer.toJson<DateTime?>(openedAt),
      'openedBy': serializer.toJson<String?>(openedBy),
      'paoMonths': serializer.toJson<int?>(paoMonths),
      'useBy': serializer.toJson<String?>(useBy),
      'disposedAt': serializer.toJson<DateTime?>(disposedAt),
      'disposedBy': serializer.toJson<String?>(disposedBy),
      'note': serializer.toJson<String?>(note),
      'createdBy': serializer.toJson<String>(createdBy),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  MaterialContainer copyWith({
    String? id,
    String? tenantId,
    String? materialId,
    Value<String?> batchId = const Value.absent(),
    String? code,
    Value<String?> parentId = const Value.absent(),
    Value<double?> volume = const Value.absent(),
    Value<String?> unit = const Value.absent(),
    String? status,
    Value<DateTime?> openedAt = const Value.absent(),
    Value<String?> openedBy = const Value.absent(),
    Value<int?> paoMonths = const Value.absent(),
    Value<String?> useBy = const Value.absent(),
    Value<DateTime?> disposedAt = const Value.absent(),
    Value<String?> disposedBy = const Value.absent(),
    Value<String?> note = const Value.absent(),
    String? createdBy,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) => MaterialContainer(
    id: id ?? this.id,
    tenantId: tenantId ?? this.tenantId,
    materialId: materialId ?? this.materialId,
    batchId: batchId.present ? batchId.value : this.batchId,
    code: code ?? this.code,
    parentId: parentId.present ? parentId.value : this.parentId,
    volume: volume.present ? volume.value : this.volume,
    unit: unit.present ? unit.value : this.unit,
    status: status ?? this.status,
    openedAt: openedAt.present ? openedAt.value : this.openedAt,
    openedBy: openedBy.present ? openedBy.value : this.openedBy,
    paoMonths: paoMonths.present ? paoMonths.value : this.paoMonths,
    useBy: useBy.present ? useBy.value : this.useBy,
    disposedAt: disposedAt.present ? disposedAt.value : this.disposedAt,
    disposedBy: disposedBy.present ? disposedBy.value : this.disposedBy,
    note: note.present ? note.value : this.note,
    createdBy: createdBy ?? this.createdBy,
    createdAt: createdAt ?? this.createdAt,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  MaterialContainer copyWithCompanion(MaterialContainersCompanion data) {
    return MaterialContainer(
      id: data.id.present ? data.id.value : this.id,
      tenantId: data.tenantId.present ? data.tenantId.value : this.tenantId,
      materialId: data.materialId.present
          ? data.materialId.value
          : this.materialId,
      batchId: data.batchId.present ? data.batchId.value : this.batchId,
      code: data.code.present ? data.code.value : this.code,
      parentId: data.parentId.present ? data.parentId.value : this.parentId,
      volume: data.volume.present ? data.volume.value : this.volume,
      unit: data.unit.present ? data.unit.value : this.unit,
      status: data.status.present ? data.status.value : this.status,
      openedAt: data.openedAt.present ? data.openedAt.value : this.openedAt,
      openedBy: data.openedBy.present ? data.openedBy.value : this.openedBy,
      paoMonths: data.paoMonths.present ? data.paoMonths.value : this.paoMonths,
      useBy: data.useBy.present ? data.useBy.value : this.useBy,
      disposedAt: data.disposedAt.present
          ? data.disposedAt.value
          : this.disposedAt,
      disposedBy: data.disposedBy.present
          ? data.disposedBy.value
          : this.disposedBy,
      note: data.note.present ? data.note.value : this.note,
      createdBy: data.createdBy.present ? data.createdBy.value : this.createdBy,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('MaterialContainer(')
          ..write('id: $id, ')
          ..write('tenantId: $tenantId, ')
          ..write('materialId: $materialId, ')
          ..write('batchId: $batchId, ')
          ..write('code: $code, ')
          ..write('parentId: $parentId, ')
          ..write('volume: $volume, ')
          ..write('unit: $unit, ')
          ..write('status: $status, ')
          ..write('openedAt: $openedAt, ')
          ..write('openedBy: $openedBy, ')
          ..write('paoMonths: $paoMonths, ')
          ..write('useBy: $useBy, ')
          ..write('disposedAt: $disposedAt, ')
          ..write('disposedBy: $disposedBy, ')
          ..write('note: $note, ')
          ..write('createdBy: $createdBy, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    tenantId,
    materialId,
    batchId,
    code,
    parentId,
    volume,
    unit,
    status,
    openedAt,
    openedBy,
    paoMonths,
    useBy,
    disposedAt,
    disposedBy,
    note,
    createdBy,
    createdAt,
    updatedAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is MaterialContainer &&
          other.id == this.id &&
          other.tenantId == this.tenantId &&
          other.materialId == this.materialId &&
          other.batchId == this.batchId &&
          other.code == this.code &&
          other.parentId == this.parentId &&
          other.volume == this.volume &&
          other.unit == this.unit &&
          other.status == this.status &&
          other.openedAt == this.openedAt &&
          other.openedBy == this.openedBy &&
          other.paoMonths == this.paoMonths &&
          other.useBy == this.useBy &&
          other.disposedAt == this.disposedAt &&
          other.disposedBy == this.disposedBy &&
          other.note == this.note &&
          other.createdBy == this.createdBy &&
          other.createdAt == this.createdAt &&
          other.updatedAt == this.updatedAt);
}

class MaterialContainersCompanion extends UpdateCompanion<MaterialContainer> {
  final Value<String> id;
  final Value<String> tenantId;
  final Value<String> materialId;
  final Value<String?> batchId;
  final Value<String> code;
  final Value<String?> parentId;
  final Value<double?> volume;
  final Value<String?> unit;
  final Value<String> status;
  final Value<DateTime?> openedAt;
  final Value<String?> openedBy;
  final Value<int?> paoMonths;
  final Value<String?> useBy;
  final Value<DateTime?> disposedAt;
  final Value<String?> disposedBy;
  final Value<String?> note;
  final Value<String> createdBy;
  final Value<DateTime> createdAt;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const MaterialContainersCompanion({
    this.id = const Value.absent(),
    this.tenantId = const Value.absent(),
    this.materialId = const Value.absent(),
    this.batchId = const Value.absent(),
    this.code = const Value.absent(),
    this.parentId = const Value.absent(),
    this.volume = const Value.absent(),
    this.unit = const Value.absent(),
    this.status = const Value.absent(),
    this.openedAt = const Value.absent(),
    this.openedBy = const Value.absent(),
    this.paoMonths = const Value.absent(),
    this.useBy = const Value.absent(),
    this.disposedAt = const Value.absent(),
    this.disposedBy = const Value.absent(),
    this.note = const Value.absent(),
    this.createdBy = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  MaterialContainersCompanion.insert({
    required String id,
    required String tenantId,
    required String materialId,
    this.batchId = const Value.absent(),
    required String code,
    this.parentId = const Value.absent(),
    this.volume = const Value.absent(),
    this.unit = const Value.absent(),
    required String status,
    this.openedAt = const Value.absent(),
    this.openedBy = const Value.absent(),
    this.paoMonths = const Value.absent(),
    this.useBy = const Value.absent(),
    this.disposedAt = const Value.absent(),
    this.disposedBy = const Value.absent(),
    this.note = const Value.absent(),
    required String createdBy,
    required DateTime createdAt,
    required DateTime updatedAt,
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       tenantId = Value(tenantId),
       materialId = Value(materialId),
       code = Value(code),
       status = Value(status),
       createdBy = Value(createdBy),
       createdAt = Value(createdAt),
       updatedAt = Value(updatedAt);
  static Insertable<MaterialContainer> custom({
    Expression<String>? id,
    Expression<String>? tenantId,
    Expression<String>? materialId,
    Expression<String>? batchId,
    Expression<String>? code,
    Expression<String>? parentId,
    Expression<double>? volume,
    Expression<String>? unit,
    Expression<String>? status,
    Expression<DateTime>? openedAt,
    Expression<String>? openedBy,
    Expression<int>? paoMonths,
    Expression<String>? useBy,
    Expression<DateTime>? disposedAt,
    Expression<String>? disposedBy,
    Expression<String>? note,
    Expression<String>? createdBy,
    Expression<DateTime>? createdAt,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (tenantId != null) 'tenant_id': tenantId,
      if (materialId != null) 'material_id': materialId,
      if (batchId != null) 'batch_id': batchId,
      if (code != null) 'code': code,
      if (parentId != null) 'parent_id': parentId,
      if (volume != null) 'volume': volume,
      if (unit != null) 'unit': unit,
      if (status != null) 'status': status,
      if (openedAt != null) 'opened_at': openedAt,
      if (openedBy != null) 'opened_by': openedBy,
      if (paoMonths != null) 'pao_months': paoMonths,
      if (useBy != null) 'use_by': useBy,
      if (disposedAt != null) 'disposed_at': disposedAt,
      if (disposedBy != null) 'disposed_by': disposedBy,
      if (note != null) 'note': note,
      if (createdBy != null) 'created_by': createdBy,
      if (createdAt != null) 'created_at': createdAt,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  MaterialContainersCompanion copyWith({
    Value<String>? id,
    Value<String>? tenantId,
    Value<String>? materialId,
    Value<String?>? batchId,
    Value<String>? code,
    Value<String?>? parentId,
    Value<double?>? volume,
    Value<String?>? unit,
    Value<String>? status,
    Value<DateTime?>? openedAt,
    Value<String?>? openedBy,
    Value<int?>? paoMonths,
    Value<String?>? useBy,
    Value<DateTime?>? disposedAt,
    Value<String?>? disposedBy,
    Value<String?>? note,
    Value<String>? createdBy,
    Value<DateTime>? createdAt,
    Value<DateTime>? updatedAt,
    Value<int>? rowid,
  }) {
    return MaterialContainersCompanion(
      id: id ?? this.id,
      tenantId: tenantId ?? this.tenantId,
      materialId: materialId ?? this.materialId,
      batchId: batchId ?? this.batchId,
      code: code ?? this.code,
      parentId: parentId ?? this.parentId,
      volume: volume ?? this.volume,
      unit: unit ?? this.unit,
      status: status ?? this.status,
      openedAt: openedAt ?? this.openedAt,
      openedBy: openedBy ?? this.openedBy,
      paoMonths: paoMonths ?? this.paoMonths,
      useBy: useBy ?? this.useBy,
      disposedAt: disposedAt ?? this.disposedAt,
      disposedBy: disposedBy ?? this.disposedBy,
      note: note ?? this.note,
      createdBy: createdBy ?? this.createdBy,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (tenantId.present) {
      map['tenant_id'] = Variable<String>(tenantId.value);
    }
    if (materialId.present) {
      map['material_id'] = Variable<String>(materialId.value);
    }
    if (batchId.present) {
      map['batch_id'] = Variable<String>(batchId.value);
    }
    if (code.present) {
      map['code'] = Variable<String>(code.value);
    }
    if (parentId.present) {
      map['parent_id'] = Variable<String>(parentId.value);
    }
    if (volume.present) {
      map['volume'] = Variable<double>(volume.value);
    }
    if (unit.present) {
      map['unit'] = Variable<String>(unit.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (openedAt.present) {
      map['opened_at'] = Variable<DateTime>(openedAt.value);
    }
    if (openedBy.present) {
      map['opened_by'] = Variable<String>(openedBy.value);
    }
    if (paoMonths.present) {
      map['pao_months'] = Variable<int>(paoMonths.value);
    }
    if (useBy.present) {
      map['use_by'] = Variable<String>(useBy.value);
    }
    if (disposedAt.present) {
      map['disposed_at'] = Variable<DateTime>(disposedAt.value);
    }
    if (disposedBy.present) {
      map['disposed_by'] = Variable<String>(disposedBy.value);
    }
    if (note.present) {
      map['note'] = Variable<String>(note.value);
    }
    if (createdBy.present) {
      map['created_by'] = Variable<String>(createdBy.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('MaterialContainersCompanion(')
          ..write('id: $id, ')
          ..write('tenantId: $tenantId, ')
          ..write('materialId: $materialId, ')
          ..write('batchId: $batchId, ')
          ..write('code: $code, ')
          ..write('parentId: $parentId, ')
          ..write('volume: $volume, ')
          ..write('unit: $unit, ')
          ..write('status: $status, ')
          ..write('openedAt: $openedAt, ')
          ..write('openedBy: $openedBy, ')
          ..write('paoMonths: $paoMonths, ')
          ..write('useBy: $useBy, ')
          ..write('disposedAt: $disposedAt, ')
          ..write('disposedBy: $disposedBy, ')
          ..write('note: $note, ')
          ..write('createdBy: $createdBy, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $OutboxTable extends Outbox with TableInfo<$OutboxTable, OutboxData> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $OutboxTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    hasAutoIncrement: true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'PRIMARY KEY AUTOINCREMENT',
    ),
  );
  static const VerificationMeta _idempotencyKeyMeta = const VerificationMeta(
    'idempotencyKey',
  );
  @override
  late final GeneratedColumn<String> idempotencyKey = GeneratedColumn<String>(
    'idempotency_key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _kindMeta = const VerificationMeta('kind');
  @override
  late final GeneratedColumn<String> kind = GeneratedColumn<String>(
    'kind',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _payloadMeta = const VerificationMeta(
    'payload',
  );
  @override
  late final GeneratedColumn<String> payload = GeneratedColumn<String>(
    'payload',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _labelMeta = const VerificationMeta('label');
  @override
  late final GeneratedColumn<String> label = GeneratedColumn<String>(
    'label',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _happenedAtMeta = const VerificationMeta(
    'happenedAt',
  );
  @override
  late final GeneratedColumn<DateTime> happenedAt = GeneratedColumn<DateTime>(
    'happened_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _blockKeyMeta = const VerificationMeta(
    'blockKey',
  );
  @override
  late final GeneratedColumn<String> blockKey = GeneratedColumn<String>(
    'block_key',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _attemptsMeta = const VerificationMeta(
    'attempts',
  );
  @override
  late final GeneratedColumn<int> attempts = GeneratedColumn<int>(
    'attempts',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _stateMeta = const VerificationMeta('state');
  @override
  late final GeneratedColumn<String> state = GeneratedColumn<String>(
    'state',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('pending'),
  );
  static const VerificationMeta _errorMeta = const VerificationMeta('error');
  @override
  late final GeneratedColumn<String> error = GeneratedColumn<String>(
    'error',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    idempotencyKey,
    kind,
    payload,
    label,
    happenedAt,
    blockKey,
    attempts,
    state,
    error,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'outbox';
  @override
  VerificationContext validateIntegrity(
    Insertable<OutboxData> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('idempotency_key')) {
      context.handle(
        _idempotencyKeyMeta,
        idempotencyKey.isAcceptableOrUnknown(
          data['idempotency_key']!,
          _idempotencyKeyMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_idempotencyKeyMeta);
    }
    if (data.containsKey('kind')) {
      context.handle(
        _kindMeta,
        kind.isAcceptableOrUnknown(data['kind']!, _kindMeta),
      );
    } else if (isInserting) {
      context.missing(_kindMeta);
    }
    if (data.containsKey('payload')) {
      context.handle(
        _payloadMeta,
        payload.isAcceptableOrUnknown(data['payload']!, _payloadMeta),
      );
    } else if (isInserting) {
      context.missing(_payloadMeta);
    }
    if (data.containsKey('label')) {
      context.handle(
        _labelMeta,
        label.isAcceptableOrUnknown(data['label']!, _labelMeta),
      );
    } else if (isInserting) {
      context.missing(_labelMeta);
    }
    if (data.containsKey('happened_at')) {
      context.handle(
        _happenedAtMeta,
        happenedAt.isAcceptableOrUnknown(data['happened_at']!, _happenedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_happenedAtMeta);
    }
    if (data.containsKey('block_key')) {
      context.handle(
        _blockKeyMeta,
        blockKey.isAcceptableOrUnknown(data['block_key']!, _blockKeyMeta),
      );
    }
    if (data.containsKey('attempts')) {
      context.handle(
        _attemptsMeta,
        attempts.isAcceptableOrUnknown(data['attempts']!, _attemptsMeta),
      );
    }
    if (data.containsKey('state')) {
      context.handle(
        _stateMeta,
        state.isAcceptableOrUnknown(data['state']!, _stateMeta),
      );
    }
    if (data.containsKey('error')) {
      context.handle(
        _errorMeta,
        error.isAcceptableOrUnknown(data['error']!, _errorMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  OutboxData map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return OutboxData(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      idempotencyKey: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}idempotency_key'],
      )!,
      kind: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}kind'],
      )!,
      payload: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}payload'],
      )!,
      label: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}label'],
      )!,
      happenedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}happened_at'],
      )!,
      blockKey: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}block_key'],
      ),
      attempts: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}attempts'],
      )!,
      state: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}state'],
      )!,
      error: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}error'],
      ),
    );
  }

  @override
  $OutboxTable createAlias(String alias) {
    return $OutboxTable(attachedDatabase, alias);
  }
}

class OutboxData extends DataClass implements Insertable<OutboxData> {
  final int id;

  /// Ключ идемпотентности, сгенерированный НА ТЕЛЕФОНЕ в момент действия
  /// и неизменный при повторах. Ради него в базе у record_stock_movement
  /// есть параметр p_idempotency_key. Смысл: связь оборвалась после того,
  /// как сервер принял списание, но до того, как ответил — повтор придёт
  /// с тем же ключом и товар не спишется дважды.
  final String idempotencyKey;

  /// Что делаем: 'container.status', 'stock.movement', 'journal.cleaning',
  /// 'journal.solution', 'journal.sterilization'. Разбор — в outbox.dart.
  final String kind;

  /// Параметры действия, JSON.
  final String payload;

  /// Человеческая подпись для полосы «N записів чекають мережі»:
  /// «Відкрити банку · B-124». Мастер должен видеть, что именно висит.
  final String label;

  /// Время НАЖАТИЯ, а не отправки. В журнал уборки должно попасть
  /// время, когда мастер реально протёр стол, а не когда в подвале
  /// появился интернет. Это прямо влияет на проверку.
  final DateTime happenedAt;

  /// Ключ блокировки порядка: операции с одним объектом уходят строго
  /// по очереди. «Открыть банку» и «списать из неё» местами меняться
  /// не должны. Обычно это id ёмкости или материала.
  final String? blockKey;
  final int attempts;

  /// pending — ждёт отправки; sent — доехало; failed — сервер отверг
  /// по существу (нет прав, сторож не пустил). failed НЕ удаляется молча:
  /// потерянная запись санитарного журнала — это штраф у клиента.
  final String state;
  final String? error;
  const OutboxData({
    required this.id,
    required this.idempotencyKey,
    required this.kind,
    required this.payload,
    required this.label,
    required this.happenedAt,
    this.blockKey,
    required this.attempts,
    required this.state,
    this.error,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['idempotency_key'] = Variable<String>(idempotencyKey);
    map['kind'] = Variable<String>(kind);
    map['payload'] = Variable<String>(payload);
    map['label'] = Variable<String>(label);
    map['happened_at'] = Variable<DateTime>(happenedAt);
    if (!nullToAbsent || blockKey != null) {
      map['block_key'] = Variable<String>(blockKey);
    }
    map['attempts'] = Variable<int>(attempts);
    map['state'] = Variable<String>(state);
    if (!nullToAbsent || error != null) {
      map['error'] = Variable<String>(error);
    }
    return map;
  }

  OutboxCompanion toCompanion(bool nullToAbsent) {
    return OutboxCompanion(
      id: Value(id),
      idempotencyKey: Value(idempotencyKey),
      kind: Value(kind),
      payload: Value(payload),
      label: Value(label),
      happenedAt: Value(happenedAt),
      blockKey: blockKey == null && nullToAbsent
          ? const Value.absent()
          : Value(blockKey),
      attempts: Value(attempts),
      state: Value(state),
      error: error == null && nullToAbsent
          ? const Value.absent()
          : Value(error),
    );
  }

  factory OutboxData.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return OutboxData(
      id: serializer.fromJson<int>(json['id']),
      idempotencyKey: serializer.fromJson<String>(json['idempotencyKey']),
      kind: serializer.fromJson<String>(json['kind']),
      payload: serializer.fromJson<String>(json['payload']),
      label: serializer.fromJson<String>(json['label']),
      happenedAt: serializer.fromJson<DateTime>(json['happenedAt']),
      blockKey: serializer.fromJson<String?>(json['blockKey']),
      attempts: serializer.fromJson<int>(json['attempts']),
      state: serializer.fromJson<String>(json['state']),
      error: serializer.fromJson<String?>(json['error']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'idempotencyKey': serializer.toJson<String>(idempotencyKey),
      'kind': serializer.toJson<String>(kind),
      'payload': serializer.toJson<String>(payload),
      'label': serializer.toJson<String>(label),
      'happenedAt': serializer.toJson<DateTime>(happenedAt),
      'blockKey': serializer.toJson<String?>(blockKey),
      'attempts': serializer.toJson<int>(attempts),
      'state': serializer.toJson<String>(state),
      'error': serializer.toJson<String?>(error),
    };
  }

  OutboxData copyWith({
    int? id,
    String? idempotencyKey,
    String? kind,
    String? payload,
    String? label,
    DateTime? happenedAt,
    Value<String?> blockKey = const Value.absent(),
    int? attempts,
    String? state,
    Value<String?> error = const Value.absent(),
  }) => OutboxData(
    id: id ?? this.id,
    idempotencyKey: idempotencyKey ?? this.idempotencyKey,
    kind: kind ?? this.kind,
    payload: payload ?? this.payload,
    label: label ?? this.label,
    happenedAt: happenedAt ?? this.happenedAt,
    blockKey: blockKey.present ? blockKey.value : this.blockKey,
    attempts: attempts ?? this.attempts,
    state: state ?? this.state,
    error: error.present ? error.value : this.error,
  );
  OutboxData copyWithCompanion(OutboxCompanion data) {
    return OutboxData(
      id: data.id.present ? data.id.value : this.id,
      idempotencyKey: data.idempotencyKey.present
          ? data.idempotencyKey.value
          : this.idempotencyKey,
      kind: data.kind.present ? data.kind.value : this.kind,
      payload: data.payload.present ? data.payload.value : this.payload,
      label: data.label.present ? data.label.value : this.label,
      happenedAt: data.happenedAt.present
          ? data.happenedAt.value
          : this.happenedAt,
      blockKey: data.blockKey.present ? data.blockKey.value : this.blockKey,
      attempts: data.attempts.present ? data.attempts.value : this.attempts,
      state: data.state.present ? data.state.value : this.state,
      error: data.error.present ? data.error.value : this.error,
    );
  }

  @override
  String toString() {
    return (StringBuffer('OutboxData(')
          ..write('id: $id, ')
          ..write('idempotencyKey: $idempotencyKey, ')
          ..write('kind: $kind, ')
          ..write('payload: $payload, ')
          ..write('label: $label, ')
          ..write('happenedAt: $happenedAt, ')
          ..write('blockKey: $blockKey, ')
          ..write('attempts: $attempts, ')
          ..write('state: $state, ')
          ..write('error: $error')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    idempotencyKey,
    kind,
    payload,
    label,
    happenedAt,
    blockKey,
    attempts,
    state,
    error,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is OutboxData &&
          other.id == this.id &&
          other.idempotencyKey == this.idempotencyKey &&
          other.kind == this.kind &&
          other.payload == this.payload &&
          other.label == this.label &&
          other.happenedAt == this.happenedAt &&
          other.blockKey == this.blockKey &&
          other.attempts == this.attempts &&
          other.state == this.state &&
          other.error == this.error);
}

class OutboxCompanion extends UpdateCompanion<OutboxData> {
  final Value<int> id;
  final Value<String> idempotencyKey;
  final Value<String> kind;
  final Value<String> payload;
  final Value<String> label;
  final Value<DateTime> happenedAt;
  final Value<String?> blockKey;
  final Value<int> attempts;
  final Value<String> state;
  final Value<String?> error;
  const OutboxCompanion({
    this.id = const Value.absent(),
    this.idempotencyKey = const Value.absent(),
    this.kind = const Value.absent(),
    this.payload = const Value.absent(),
    this.label = const Value.absent(),
    this.happenedAt = const Value.absent(),
    this.blockKey = const Value.absent(),
    this.attempts = const Value.absent(),
    this.state = const Value.absent(),
    this.error = const Value.absent(),
  });
  OutboxCompanion.insert({
    this.id = const Value.absent(),
    required String idempotencyKey,
    required String kind,
    required String payload,
    required String label,
    required DateTime happenedAt,
    this.blockKey = const Value.absent(),
    this.attempts = const Value.absent(),
    this.state = const Value.absent(),
    this.error = const Value.absent(),
  }) : idempotencyKey = Value(idempotencyKey),
       kind = Value(kind),
       payload = Value(payload),
       label = Value(label),
       happenedAt = Value(happenedAt);
  static Insertable<OutboxData> custom({
    Expression<int>? id,
    Expression<String>? idempotencyKey,
    Expression<String>? kind,
    Expression<String>? payload,
    Expression<String>? label,
    Expression<DateTime>? happenedAt,
    Expression<String>? blockKey,
    Expression<int>? attempts,
    Expression<String>? state,
    Expression<String>? error,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (idempotencyKey != null) 'idempotency_key': idempotencyKey,
      if (kind != null) 'kind': kind,
      if (payload != null) 'payload': payload,
      if (label != null) 'label': label,
      if (happenedAt != null) 'happened_at': happenedAt,
      if (blockKey != null) 'block_key': blockKey,
      if (attempts != null) 'attempts': attempts,
      if (state != null) 'state': state,
      if (error != null) 'error': error,
    });
  }

  OutboxCompanion copyWith({
    Value<int>? id,
    Value<String>? idempotencyKey,
    Value<String>? kind,
    Value<String>? payload,
    Value<String>? label,
    Value<DateTime>? happenedAt,
    Value<String?>? blockKey,
    Value<int>? attempts,
    Value<String>? state,
    Value<String?>? error,
  }) {
    return OutboxCompanion(
      id: id ?? this.id,
      idempotencyKey: idempotencyKey ?? this.idempotencyKey,
      kind: kind ?? this.kind,
      payload: payload ?? this.payload,
      label: label ?? this.label,
      happenedAt: happenedAt ?? this.happenedAt,
      blockKey: blockKey ?? this.blockKey,
      attempts: attempts ?? this.attempts,
      state: state ?? this.state,
      error: error ?? this.error,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (idempotencyKey.present) {
      map['idempotency_key'] = Variable<String>(idempotencyKey.value);
    }
    if (kind.present) {
      map['kind'] = Variable<String>(kind.value);
    }
    if (payload.present) {
      map['payload'] = Variable<String>(payload.value);
    }
    if (label.present) {
      map['label'] = Variable<String>(label.value);
    }
    if (happenedAt.present) {
      map['happened_at'] = Variable<DateTime>(happenedAt.value);
    }
    if (blockKey.present) {
      map['block_key'] = Variable<String>(blockKey.value);
    }
    if (attempts.present) {
      map['attempts'] = Variable<int>(attempts.value);
    }
    if (state.present) {
      map['state'] = Variable<String>(state.value);
    }
    if (error.present) {
      map['error'] = Variable<String>(error.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('OutboxCompanion(')
          ..write('id: $id, ')
          ..write('idempotencyKey: $idempotencyKey, ')
          ..write('kind: $kind, ')
          ..write('payload: $payload, ')
          ..write('label: $label, ')
          ..write('happenedAt: $happenedAt, ')
          ..write('blockKey: $blockKey, ')
          ..write('attempts: $attempts, ')
          ..write('state: $state, ')
          ..write('error: $error')
          ..write(')'))
        .toString();
  }
}

class $SyncStateTable extends SyncState
    with TableInfo<$SyncStateTable, SyncStateData> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SyncStateTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _tableKeyMeta = const VerificationMeta(
    'tableKey',
  );
  @override
  late final GeneratedColumn<String> tableKey = GeneratedColumn<String>(
    'table_name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _lastSyncedAtMeta = const VerificationMeta(
    'lastSyncedAt',
  );
  @override
  late final GeneratedColumn<DateTime> lastSyncedAt = GeneratedColumn<DateTime>(
    'last_synced_at',
    aliasedName,
    true,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [tableKey, lastSyncedAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'sync_state';
  @override
  VerificationContext validateIntegrity(
    Insertable<SyncStateData> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('table_name')) {
      context.handle(
        _tableKeyMeta,
        tableKey.isAcceptableOrUnknown(data['table_name']!, _tableKeyMeta),
      );
    } else if (isInserting) {
      context.missing(_tableKeyMeta);
    }
    if (data.containsKey('last_synced_at')) {
      context.handle(
        _lastSyncedAtMeta,
        lastSyncedAt.isAcceptableOrUnknown(
          data['last_synced_at']!,
          _lastSyncedAtMeta,
        ),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {tableKey};
  @override
  SyncStateData map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return SyncStateData(
      tableKey: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}table_name'],
      )!,
      lastSyncedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}last_synced_at'],
      ),
    );
  }

  @override
  $SyncStateTable createAlias(String alias) {
    return $SyncStateTable(attachedDatabase, alias);
  }
}

class SyncStateData extends DataClass implements Insertable<SyncStateData> {
  /// Не `tableName`: у drift этим геттером переопределяют имя самой
  /// таблицы, и колонка с таким именем не компилируется. В SQLite
  /// колонка по-прежнему называется `table_name`.
  final String tableKey;
  final DateTime? lastSyncedAt;
  const SyncStateData({required this.tableKey, this.lastSyncedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['table_name'] = Variable<String>(tableKey);
    if (!nullToAbsent || lastSyncedAt != null) {
      map['last_synced_at'] = Variable<DateTime>(lastSyncedAt);
    }
    return map;
  }

  SyncStateCompanion toCompanion(bool nullToAbsent) {
    return SyncStateCompanion(
      tableKey: Value(tableKey),
      lastSyncedAt: lastSyncedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(lastSyncedAt),
    );
  }

  factory SyncStateData.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return SyncStateData(
      tableKey: serializer.fromJson<String>(json['tableKey']),
      lastSyncedAt: serializer.fromJson<DateTime?>(json['lastSyncedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'tableKey': serializer.toJson<String>(tableKey),
      'lastSyncedAt': serializer.toJson<DateTime?>(lastSyncedAt),
    };
  }

  SyncStateData copyWith({
    String? tableKey,
    Value<DateTime?> lastSyncedAt = const Value.absent(),
  }) => SyncStateData(
    tableKey: tableKey ?? this.tableKey,
    lastSyncedAt: lastSyncedAt.present ? lastSyncedAt.value : this.lastSyncedAt,
  );
  SyncStateData copyWithCompanion(SyncStateCompanion data) {
    return SyncStateData(
      tableKey: data.tableKey.present ? data.tableKey.value : this.tableKey,
      lastSyncedAt: data.lastSyncedAt.present
          ? data.lastSyncedAt.value
          : this.lastSyncedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SyncStateData(')
          ..write('tableKey: $tableKey, ')
          ..write('lastSyncedAt: $lastSyncedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(tableKey, lastSyncedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is SyncStateData &&
          other.tableKey == this.tableKey &&
          other.lastSyncedAt == this.lastSyncedAt);
}

class SyncStateCompanion extends UpdateCompanion<SyncStateData> {
  final Value<String> tableKey;
  final Value<DateTime?> lastSyncedAt;
  final Value<int> rowid;
  const SyncStateCompanion({
    this.tableKey = const Value.absent(),
    this.lastSyncedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  SyncStateCompanion.insert({
    required String tableKey,
    this.lastSyncedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : tableKey = Value(tableKey);
  static Insertable<SyncStateData> custom({
    Expression<String>? tableKey,
    Expression<DateTime>? lastSyncedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (tableKey != null) 'table_name': tableKey,
      if (lastSyncedAt != null) 'last_synced_at': lastSyncedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  SyncStateCompanion copyWith({
    Value<String>? tableKey,
    Value<DateTime?>? lastSyncedAt,
    Value<int>? rowid,
  }) {
    return SyncStateCompanion(
      tableKey: tableKey ?? this.tableKey,
      lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (tableKey.present) {
      map['table_name'] = Variable<String>(tableKey.value);
    }
    if (lastSyncedAt.present) {
      map['last_synced_at'] = Variable<DateTime>(lastSyncedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SyncStateCompanion(')
          ..write('tableKey: $tableKey, ')
          ..write('lastSyncedAt: $lastSyncedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$LocalDb extends GeneratedDatabase {
  _$LocalDb(QueryExecutor e) : super(e);
  $LocalDbManager get managers => $LocalDbManager(this);
  late final $MaterialsTable materials = $MaterialsTable(this);
  late final $MaterialBatchesTable materialBatches = $MaterialBatchesTable(
    this,
  );
  late final $MaterialContainersTable materialContainers =
      $MaterialContainersTable(this);
  late final $OutboxTable outbox = $OutboxTable(this);
  late final $SyncStateTable syncState = $SyncStateTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    materials,
    materialBatches,
    materialContainers,
    outbox,
    syncState,
  ];
}

typedef $$MaterialsTableCreateCompanionBuilder =
    MaterialsCompanion Function({
      required String id,
      required String tenantId,
      required String name,
      required String unit,
      Value<String?> category,
      Value<double> currentStock,
      Value<double> minStockThreshold,
      Value<double?> costPerUnit,
      Value<String?> sku,
      Value<String?> brand,
      Value<String?> countryOfOrigin,
      Value<String?> inci,
      Value<String?> notificationCode,
      Value<int?> paoMonths,
      Value<bool> isCosmetic,
      Value<bool> isActive,
      Value<String?> supplierId,
      Value<String?> locationId,
      required DateTime createdAt,
      required DateTime updatedAt,
      Value<int> rowid,
    });
typedef $$MaterialsTableUpdateCompanionBuilder =
    MaterialsCompanion Function({
      Value<String> id,
      Value<String> tenantId,
      Value<String> name,
      Value<String> unit,
      Value<String?> category,
      Value<double> currentStock,
      Value<double> minStockThreshold,
      Value<double?> costPerUnit,
      Value<String?> sku,
      Value<String?> brand,
      Value<String?> countryOfOrigin,
      Value<String?> inci,
      Value<String?> notificationCode,
      Value<int?> paoMonths,
      Value<bool> isCosmetic,
      Value<bool> isActive,
      Value<String?> supplierId,
      Value<String?> locationId,
      Value<DateTime> createdAt,
      Value<DateTime> updatedAt,
      Value<int> rowid,
    });

class $$MaterialsTableFilterComposer
    extends Composer<_$LocalDb, $MaterialsTable> {
  $$MaterialsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get tenantId => $composableBuilder(
    column: $table.tenantId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get unit => $composableBuilder(
    column: $table.unit,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get category => $composableBuilder(
    column: $table.category,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get currentStock => $composableBuilder(
    column: $table.currentStock,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get minStockThreshold => $composableBuilder(
    column: $table.minStockThreshold,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get costPerUnit => $composableBuilder(
    column: $table.costPerUnit,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get sku => $composableBuilder(
    column: $table.sku,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get brand => $composableBuilder(
    column: $table.brand,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get countryOfOrigin => $composableBuilder(
    column: $table.countryOfOrigin,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get inci => $composableBuilder(
    column: $table.inci,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get notificationCode => $composableBuilder(
    column: $table.notificationCode,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get paoMonths => $composableBuilder(
    column: $table.paoMonths,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get isCosmetic => $composableBuilder(
    column: $table.isCosmetic,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<bool> get isActive => $composableBuilder(
    column: $table.isActive,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get supplierId => $composableBuilder(
    column: $table.supplierId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get locationId => $composableBuilder(
    column: $table.locationId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$MaterialsTableOrderingComposer
    extends Composer<_$LocalDb, $MaterialsTable> {
  $$MaterialsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get tenantId => $composableBuilder(
    column: $table.tenantId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get unit => $composableBuilder(
    column: $table.unit,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get category => $composableBuilder(
    column: $table.category,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get currentStock => $composableBuilder(
    column: $table.currentStock,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get minStockThreshold => $composableBuilder(
    column: $table.minStockThreshold,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get costPerUnit => $composableBuilder(
    column: $table.costPerUnit,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get sku => $composableBuilder(
    column: $table.sku,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get brand => $composableBuilder(
    column: $table.brand,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get countryOfOrigin => $composableBuilder(
    column: $table.countryOfOrigin,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get inci => $composableBuilder(
    column: $table.inci,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get notificationCode => $composableBuilder(
    column: $table.notificationCode,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get paoMonths => $composableBuilder(
    column: $table.paoMonths,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get isCosmetic => $composableBuilder(
    column: $table.isCosmetic,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<bool> get isActive => $composableBuilder(
    column: $table.isActive,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get supplierId => $composableBuilder(
    column: $table.supplierId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get locationId => $composableBuilder(
    column: $table.locationId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$MaterialsTableAnnotationComposer
    extends Composer<_$LocalDb, $MaterialsTable> {
  $$MaterialsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get tenantId =>
      $composableBuilder(column: $table.tenantId, builder: (column) => column);

  GeneratedColumn<String> get name =>
      $composableBuilder(column: $table.name, builder: (column) => column);

  GeneratedColumn<String> get unit =>
      $composableBuilder(column: $table.unit, builder: (column) => column);

  GeneratedColumn<String> get category =>
      $composableBuilder(column: $table.category, builder: (column) => column);

  GeneratedColumn<double> get currentStock => $composableBuilder(
    column: $table.currentStock,
    builder: (column) => column,
  );

  GeneratedColumn<double> get minStockThreshold => $composableBuilder(
    column: $table.minStockThreshold,
    builder: (column) => column,
  );

  GeneratedColumn<double> get costPerUnit => $composableBuilder(
    column: $table.costPerUnit,
    builder: (column) => column,
  );

  GeneratedColumn<String> get sku =>
      $composableBuilder(column: $table.sku, builder: (column) => column);

  GeneratedColumn<String> get brand =>
      $composableBuilder(column: $table.brand, builder: (column) => column);

  GeneratedColumn<String> get countryOfOrigin => $composableBuilder(
    column: $table.countryOfOrigin,
    builder: (column) => column,
  );

  GeneratedColumn<String> get inci =>
      $composableBuilder(column: $table.inci, builder: (column) => column);

  GeneratedColumn<String> get notificationCode => $composableBuilder(
    column: $table.notificationCode,
    builder: (column) => column,
  );

  GeneratedColumn<int> get paoMonths =>
      $composableBuilder(column: $table.paoMonths, builder: (column) => column);

  GeneratedColumn<bool> get isCosmetic => $composableBuilder(
    column: $table.isCosmetic,
    builder: (column) => column,
  );

  GeneratedColumn<bool> get isActive =>
      $composableBuilder(column: $table.isActive, builder: (column) => column);

  GeneratedColumn<String> get supplierId => $composableBuilder(
    column: $table.supplierId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get locationId => $composableBuilder(
    column: $table.locationId,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$MaterialsTableTableManager
    extends
        RootTableManager<
          _$LocalDb,
          $MaterialsTable,
          Material,
          $$MaterialsTableFilterComposer,
          $$MaterialsTableOrderingComposer,
          $$MaterialsTableAnnotationComposer,
          $$MaterialsTableCreateCompanionBuilder,
          $$MaterialsTableUpdateCompanionBuilder,
          (Material, BaseReferences<_$LocalDb, $MaterialsTable, Material>),
          Material,
          PrefetchHooks Function()
        > {
  $$MaterialsTableTableManager(_$LocalDb db, $MaterialsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$MaterialsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$MaterialsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$MaterialsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> tenantId = const Value.absent(),
                Value<String> name = const Value.absent(),
                Value<String> unit = const Value.absent(),
                Value<String?> category = const Value.absent(),
                Value<double> currentStock = const Value.absent(),
                Value<double> minStockThreshold = const Value.absent(),
                Value<double?> costPerUnit = const Value.absent(),
                Value<String?> sku = const Value.absent(),
                Value<String?> brand = const Value.absent(),
                Value<String?> countryOfOrigin = const Value.absent(),
                Value<String?> inci = const Value.absent(),
                Value<String?> notificationCode = const Value.absent(),
                Value<int?> paoMonths = const Value.absent(),
                Value<bool> isCosmetic = const Value.absent(),
                Value<bool> isActive = const Value.absent(),
                Value<String?> supplierId = const Value.absent(),
                Value<String?> locationId = const Value.absent(),
                Value<DateTime> createdAt = const Value.absent(),
                Value<DateTime> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => MaterialsCompanion(
                id: id,
                tenantId: tenantId,
                name: name,
                unit: unit,
                category: category,
                currentStock: currentStock,
                minStockThreshold: minStockThreshold,
                costPerUnit: costPerUnit,
                sku: sku,
                brand: brand,
                countryOfOrigin: countryOfOrigin,
                inci: inci,
                notificationCode: notificationCode,
                paoMonths: paoMonths,
                isCosmetic: isCosmetic,
                isActive: isActive,
                supplierId: supplierId,
                locationId: locationId,
                createdAt: createdAt,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String tenantId,
                required String name,
                required String unit,
                Value<String?> category = const Value.absent(),
                Value<double> currentStock = const Value.absent(),
                Value<double> minStockThreshold = const Value.absent(),
                Value<double?> costPerUnit = const Value.absent(),
                Value<String?> sku = const Value.absent(),
                Value<String?> brand = const Value.absent(),
                Value<String?> countryOfOrigin = const Value.absent(),
                Value<String?> inci = const Value.absent(),
                Value<String?> notificationCode = const Value.absent(),
                Value<int?> paoMonths = const Value.absent(),
                Value<bool> isCosmetic = const Value.absent(),
                Value<bool> isActive = const Value.absent(),
                Value<String?> supplierId = const Value.absent(),
                Value<String?> locationId = const Value.absent(),
                required DateTime createdAt,
                required DateTime updatedAt,
                Value<int> rowid = const Value.absent(),
              }) => MaterialsCompanion.insert(
                id: id,
                tenantId: tenantId,
                name: name,
                unit: unit,
                category: category,
                currentStock: currentStock,
                minStockThreshold: minStockThreshold,
                costPerUnit: costPerUnit,
                sku: sku,
                brand: brand,
                countryOfOrigin: countryOfOrigin,
                inci: inci,
                notificationCode: notificationCode,
                paoMonths: paoMonths,
                isCosmetic: isCosmetic,
                isActive: isActive,
                supplierId: supplierId,
                locationId: locationId,
                createdAt: createdAt,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$MaterialsTableProcessedTableManager =
    ProcessedTableManager<
      _$LocalDb,
      $MaterialsTable,
      Material,
      $$MaterialsTableFilterComposer,
      $$MaterialsTableOrderingComposer,
      $$MaterialsTableAnnotationComposer,
      $$MaterialsTableCreateCompanionBuilder,
      $$MaterialsTableUpdateCompanionBuilder,
      (Material, BaseReferences<_$LocalDb, $MaterialsTable, Material>),
      Material,
      PrefetchHooks Function()
    >;
typedef $$MaterialBatchesTableCreateCompanionBuilder =
    MaterialBatchesCompanion Function({
      required String id,
      required String tenantId,
      required String materialId,
      required String batchNumber,
      required String expiryDate,
      required String receivedAt,
      Value<String?> supplierId,
      Value<String?> note,
      required String createdBy,
      required DateTime createdAt,
      Value<int> rowid,
    });
typedef $$MaterialBatchesTableUpdateCompanionBuilder =
    MaterialBatchesCompanion Function({
      Value<String> id,
      Value<String> tenantId,
      Value<String> materialId,
      Value<String> batchNumber,
      Value<String> expiryDate,
      Value<String> receivedAt,
      Value<String?> supplierId,
      Value<String?> note,
      Value<String> createdBy,
      Value<DateTime> createdAt,
      Value<int> rowid,
    });

class $$MaterialBatchesTableFilterComposer
    extends Composer<_$LocalDb, $MaterialBatchesTable> {
  $$MaterialBatchesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get tenantId => $composableBuilder(
    column: $table.tenantId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get materialId => $composableBuilder(
    column: $table.materialId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get batchNumber => $composableBuilder(
    column: $table.batchNumber,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get expiryDate => $composableBuilder(
    column: $table.expiryDate,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get receivedAt => $composableBuilder(
    column: $table.receivedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get supplierId => $composableBuilder(
    column: $table.supplierId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get note => $composableBuilder(
    column: $table.note,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get createdBy => $composableBuilder(
    column: $table.createdBy,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$MaterialBatchesTableOrderingComposer
    extends Composer<_$LocalDb, $MaterialBatchesTable> {
  $$MaterialBatchesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get tenantId => $composableBuilder(
    column: $table.tenantId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get materialId => $composableBuilder(
    column: $table.materialId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get batchNumber => $composableBuilder(
    column: $table.batchNumber,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get expiryDate => $composableBuilder(
    column: $table.expiryDate,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get receivedAt => $composableBuilder(
    column: $table.receivedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get supplierId => $composableBuilder(
    column: $table.supplierId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get note => $composableBuilder(
    column: $table.note,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get createdBy => $composableBuilder(
    column: $table.createdBy,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$MaterialBatchesTableAnnotationComposer
    extends Composer<_$LocalDb, $MaterialBatchesTable> {
  $$MaterialBatchesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get tenantId =>
      $composableBuilder(column: $table.tenantId, builder: (column) => column);

  GeneratedColumn<String> get materialId => $composableBuilder(
    column: $table.materialId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get batchNumber => $composableBuilder(
    column: $table.batchNumber,
    builder: (column) => column,
  );

  GeneratedColumn<String> get expiryDate => $composableBuilder(
    column: $table.expiryDate,
    builder: (column) => column,
  );

  GeneratedColumn<String> get receivedAt => $composableBuilder(
    column: $table.receivedAt,
    builder: (column) => column,
  );

  GeneratedColumn<String> get supplierId => $composableBuilder(
    column: $table.supplierId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get note =>
      $composableBuilder(column: $table.note, builder: (column) => column);

  GeneratedColumn<String> get createdBy =>
      $composableBuilder(column: $table.createdBy, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);
}

class $$MaterialBatchesTableTableManager
    extends
        RootTableManager<
          _$LocalDb,
          $MaterialBatchesTable,
          MaterialBatche,
          $$MaterialBatchesTableFilterComposer,
          $$MaterialBatchesTableOrderingComposer,
          $$MaterialBatchesTableAnnotationComposer,
          $$MaterialBatchesTableCreateCompanionBuilder,
          $$MaterialBatchesTableUpdateCompanionBuilder,
          (
            MaterialBatche,
            BaseReferences<_$LocalDb, $MaterialBatchesTable, MaterialBatche>,
          ),
          MaterialBatche,
          PrefetchHooks Function()
        > {
  $$MaterialBatchesTableTableManager(_$LocalDb db, $MaterialBatchesTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$MaterialBatchesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$MaterialBatchesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$MaterialBatchesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> tenantId = const Value.absent(),
                Value<String> materialId = const Value.absent(),
                Value<String> batchNumber = const Value.absent(),
                Value<String> expiryDate = const Value.absent(),
                Value<String> receivedAt = const Value.absent(),
                Value<String?> supplierId = const Value.absent(),
                Value<String?> note = const Value.absent(),
                Value<String> createdBy = const Value.absent(),
                Value<DateTime> createdAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => MaterialBatchesCompanion(
                id: id,
                tenantId: tenantId,
                materialId: materialId,
                batchNumber: batchNumber,
                expiryDate: expiryDate,
                receivedAt: receivedAt,
                supplierId: supplierId,
                note: note,
                createdBy: createdBy,
                createdAt: createdAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String tenantId,
                required String materialId,
                required String batchNumber,
                required String expiryDate,
                required String receivedAt,
                Value<String?> supplierId = const Value.absent(),
                Value<String?> note = const Value.absent(),
                required String createdBy,
                required DateTime createdAt,
                Value<int> rowid = const Value.absent(),
              }) => MaterialBatchesCompanion.insert(
                id: id,
                tenantId: tenantId,
                materialId: materialId,
                batchNumber: batchNumber,
                expiryDate: expiryDate,
                receivedAt: receivedAt,
                supplierId: supplierId,
                note: note,
                createdBy: createdBy,
                createdAt: createdAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$MaterialBatchesTableProcessedTableManager =
    ProcessedTableManager<
      _$LocalDb,
      $MaterialBatchesTable,
      MaterialBatche,
      $$MaterialBatchesTableFilterComposer,
      $$MaterialBatchesTableOrderingComposer,
      $$MaterialBatchesTableAnnotationComposer,
      $$MaterialBatchesTableCreateCompanionBuilder,
      $$MaterialBatchesTableUpdateCompanionBuilder,
      (
        MaterialBatche,
        BaseReferences<_$LocalDb, $MaterialBatchesTable, MaterialBatche>,
      ),
      MaterialBatche,
      PrefetchHooks Function()
    >;
typedef $$MaterialContainersTableCreateCompanionBuilder =
    MaterialContainersCompanion Function({
      required String id,
      required String tenantId,
      required String materialId,
      Value<String?> batchId,
      required String code,
      Value<String?> parentId,
      Value<double?> volume,
      Value<String?> unit,
      required String status,
      Value<DateTime?> openedAt,
      Value<String?> openedBy,
      Value<int?> paoMonths,
      Value<String?> useBy,
      Value<DateTime?> disposedAt,
      Value<String?> disposedBy,
      Value<String?> note,
      required String createdBy,
      required DateTime createdAt,
      required DateTime updatedAt,
      Value<int> rowid,
    });
typedef $$MaterialContainersTableUpdateCompanionBuilder =
    MaterialContainersCompanion Function({
      Value<String> id,
      Value<String> tenantId,
      Value<String> materialId,
      Value<String?> batchId,
      Value<String> code,
      Value<String?> parentId,
      Value<double?> volume,
      Value<String?> unit,
      Value<String> status,
      Value<DateTime?> openedAt,
      Value<String?> openedBy,
      Value<int?> paoMonths,
      Value<String?> useBy,
      Value<DateTime?> disposedAt,
      Value<String?> disposedBy,
      Value<String?> note,
      Value<String> createdBy,
      Value<DateTime> createdAt,
      Value<DateTime> updatedAt,
      Value<int> rowid,
    });

class $$MaterialContainersTableFilterComposer
    extends Composer<_$LocalDb, $MaterialContainersTable> {
  $$MaterialContainersTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get tenantId => $composableBuilder(
    column: $table.tenantId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get materialId => $composableBuilder(
    column: $table.materialId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get batchId => $composableBuilder(
    column: $table.batchId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get code => $composableBuilder(
    column: $table.code,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get parentId => $composableBuilder(
    column: $table.parentId,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get volume => $composableBuilder(
    column: $table.volume,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get unit => $composableBuilder(
    column: $table.unit,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get openedAt => $composableBuilder(
    column: $table.openedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get openedBy => $composableBuilder(
    column: $table.openedBy,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get paoMonths => $composableBuilder(
    column: $table.paoMonths,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get useBy => $composableBuilder(
    column: $table.useBy,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get disposedAt => $composableBuilder(
    column: $table.disposedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get disposedBy => $composableBuilder(
    column: $table.disposedBy,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get note => $composableBuilder(
    column: $table.note,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get createdBy => $composableBuilder(
    column: $table.createdBy,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$MaterialContainersTableOrderingComposer
    extends Composer<_$LocalDb, $MaterialContainersTable> {
  $$MaterialContainersTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get tenantId => $composableBuilder(
    column: $table.tenantId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get materialId => $composableBuilder(
    column: $table.materialId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get batchId => $composableBuilder(
    column: $table.batchId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get code => $composableBuilder(
    column: $table.code,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get parentId => $composableBuilder(
    column: $table.parentId,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get volume => $composableBuilder(
    column: $table.volume,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get unit => $composableBuilder(
    column: $table.unit,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get openedAt => $composableBuilder(
    column: $table.openedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get openedBy => $composableBuilder(
    column: $table.openedBy,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get paoMonths => $composableBuilder(
    column: $table.paoMonths,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get useBy => $composableBuilder(
    column: $table.useBy,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get disposedAt => $composableBuilder(
    column: $table.disposedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get disposedBy => $composableBuilder(
    column: $table.disposedBy,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get note => $composableBuilder(
    column: $table.note,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get createdBy => $composableBuilder(
    column: $table.createdBy,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$MaterialContainersTableAnnotationComposer
    extends Composer<_$LocalDb, $MaterialContainersTable> {
  $$MaterialContainersTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get tenantId =>
      $composableBuilder(column: $table.tenantId, builder: (column) => column);

  GeneratedColumn<String> get materialId => $composableBuilder(
    column: $table.materialId,
    builder: (column) => column,
  );

  GeneratedColumn<String> get batchId =>
      $composableBuilder(column: $table.batchId, builder: (column) => column);

  GeneratedColumn<String> get code =>
      $composableBuilder(column: $table.code, builder: (column) => column);

  GeneratedColumn<String> get parentId =>
      $composableBuilder(column: $table.parentId, builder: (column) => column);

  GeneratedColumn<double> get volume =>
      $composableBuilder(column: $table.volume, builder: (column) => column);

  GeneratedColumn<String> get unit =>
      $composableBuilder(column: $table.unit, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<DateTime> get openedAt =>
      $composableBuilder(column: $table.openedAt, builder: (column) => column);

  GeneratedColumn<String> get openedBy =>
      $composableBuilder(column: $table.openedBy, builder: (column) => column);

  GeneratedColumn<int> get paoMonths =>
      $composableBuilder(column: $table.paoMonths, builder: (column) => column);

  GeneratedColumn<String> get useBy =>
      $composableBuilder(column: $table.useBy, builder: (column) => column);

  GeneratedColumn<DateTime> get disposedAt => $composableBuilder(
    column: $table.disposedAt,
    builder: (column) => column,
  );

  GeneratedColumn<String> get disposedBy => $composableBuilder(
    column: $table.disposedBy,
    builder: (column) => column,
  );

  GeneratedColumn<String> get note =>
      $composableBuilder(column: $table.note, builder: (column) => column);

  GeneratedColumn<String> get createdBy =>
      $composableBuilder(column: $table.createdBy, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$MaterialContainersTableTableManager
    extends
        RootTableManager<
          _$LocalDb,
          $MaterialContainersTable,
          MaterialContainer,
          $$MaterialContainersTableFilterComposer,
          $$MaterialContainersTableOrderingComposer,
          $$MaterialContainersTableAnnotationComposer,
          $$MaterialContainersTableCreateCompanionBuilder,
          $$MaterialContainersTableUpdateCompanionBuilder,
          (
            MaterialContainer,
            BaseReferences<
              _$LocalDb,
              $MaterialContainersTable,
              MaterialContainer
            >,
          ),
          MaterialContainer,
          PrefetchHooks Function()
        > {
  $$MaterialContainersTableTableManager(
    _$LocalDb db,
    $MaterialContainersTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$MaterialContainersTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$MaterialContainersTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$MaterialContainersTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> tenantId = const Value.absent(),
                Value<String> materialId = const Value.absent(),
                Value<String?> batchId = const Value.absent(),
                Value<String> code = const Value.absent(),
                Value<String?> parentId = const Value.absent(),
                Value<double?> volume = const Value.absent(),
                Value<String?> unit = const Value.absent(),
                Value<String> status = const Value.absent(),
                Value<DateTime?> openedAt = const Value.absent(),
                Value<String?> openedBy = const Value.absent(),
                Value<int?> paoMonths = const Value.absent(),
                Value<String?> useBy = const Value.absent(),
                Value<DateTime?> disposedAt = const Value.absent(),
                Value<String?> disposedBy = const Value.absent(),
                Value<String?> note = const Value.absent(),
                Value<String> createdBy = const Value.absent(),
                Value<DateTime> createdAt = const Value.absent(),
                Value<DateTime> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => MaterialContainersCompanion(
                id: id,
                tenantId: tenantId,
                materialId: materialId,
                batchId: batchId,
                code: code,
                parentId: parentId,
                volume: volume,
                unit: unit,
                status: status,
                openedAt: openedAt,
                openedBy: openedBy,
                paoMonths: paoMonths,
                useBy: useBy,
                disposedAt: disposedAt,
                disposedBy: disposedBy,
                note: note,
                createdBy: createdBy,
                createdAt: createdAt,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String tenantId,
                required String materialId,
                Value<String?> batchId = const Value.absent(),
                required String code,
                Value<String?> parentId = const Value.absent(),
                Value<double?> volume = const Value.absent(),
                Value<String?> unit = const Value.absent(),
                required String status,
                Value<DateTime?> openedAt = const Value.absent(),
                Value<String?> openedBy = const Value.absent(),
                Value<int?> paoMonths = const Value.absent(),
                Value<String?> useBy = const Value.absent(),
                Value<DateTime?> disposedAt = const Value.absent(),
                Value<String?> disposedBy = const Value.absent(),
                Value<String?> note = const Value.absent(),
                required String createdBy,
                required DateTime createdAt,
                required DateTime updatedAt,
                Value<int> rowid = const Value.absent(),
              }) => MaterialContainersCompanion.insert(
                id: id,
                tenantId: tenantId,
                materialId: materialId,
                batchId: batchId,
                code: code,
                parentId: parentId,
                volume: volume,
                unit: unit,
                status: status,
                openedAt: openedAt,
                openedBy: openedBy,
                paoMonths: paoMonths,
                useBy: useBy,
                disposedAt: disposedAt,
                disposedBy: disposedBy,
                note: note,
                createdBy: createdBy,
                createdAt: createdAt,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$MaterialContainersTableProcessedTableManager =
    ProcessedTableManager<
      _$LocalDb,
      $MaterialContainersTable,
      MaterialContainer,
      $$MaterialContainersTableFilterComposer,
      $$MaterialContainersTableOrderingComposer,
      $$MaterialContainersTableAnnotationComposer,
      $$MaterialContainersTableCreateCompanionBuilder,
      $$MaterialContainersTableUpdateCompanionBuilder,
      (
        MaterialContainer,
        BaseReferences<_$LocalDb, $MaterialContainersTable, MaterialContainer>,
      ),
      MaterialContainer,
      PrefetchHooks Function()
    >;
typedef $$OutboxTableCreateCompanionBuilder =
    OutboxCompanion Function({
      Value<int> id,
      required String idempotencyKey,
      required String kind,
      required String payload,
      required String label,
      required DateTime happenedAt,
      Value<String?> blockKey,
      Value<int> attempts,
      Value<String> state,
      Value<String?> error,
    });
typedef $$OutboxTableUpdateCompanionBuilder =
    OutboxCompanion Function({
      Value<int> id,
      Value<String> idempotencyKey,
      Value<String> kind,
      Value<String> payload,
      Value<String> label,
      Value<DateTime> happenedAt,
      Value<String?> blockKey,
      Value<int> attempts,
      Value<String> state,
      Value<String?> error,
    });

class $$OutboxTableFilterComposer extends Composer<_$LocalDb, $OutboxTable> {
  $$OutboxTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get idempotencyKey => $composableBuilder(
    column: $table.idempotencyKey,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get payload => $composableBuilder(
    column: $table.payload,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get label => $composableBuilder(
    column: $table.label,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get happenedAt => $composableBuilder(
    column: $table.happenedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get blockKey => $composableBuilder(
    column: $table.blockKey,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get attempts => $composableBuilder(
    column: $table.attempts,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get state => $composableBuilder(
    column: $table.state,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get error => $composableBuilder(
    column: $table.error,
    builder: (column) => ColumnFilters(column),
  );
}

class $$OutboxTableOrderingComposer extends Composer<_$LocalDb, $OutboxTable> {
  $$OutboxTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get idempotencyKey => $composableBuilder(
    column: $table.idempotencyKey,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get kind => $composableBuilder(
    column: $table.kind,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get payload => $composableBuilder(
    column: $table.payload,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get label => $composableBuilder(
    column: $table.label,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get happenedAt => $composableBuilder(
    column: $table.happenedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get blockKey => $composableBuilder(
    column: $table.blockKey,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get attempts => $composableBuilder(
    column: $table.attempts,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get state => $composableBuilder(
    column: $table.state,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get error => $composableBuilder(
    column: $table.error,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$OutboxTableAnnotationComposer
    extends Composer<_$LocalDb, $OutboxTable> {
  $$OutboxTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get idempotencyKey => $composableBuilder(
    column: $table.idempotencyKey,
    builder: (column) => column,
  );

  GeneratedColumn<String> get kind =>
      $composableBuilder(column: $table.kind, builder: (column) => column);

  GeneratedColumn<String> get payload =>
      $composableBuilder(column: $table.payload, builder: (column) => column);

  GeneratedColumn<String> get label =>
      $composableBuilder(column: $table.label, builder: (column) => column);

  GeneratedColumn<DateTime> get happenedAt => $composableBuilder(
    column: $table.happenedAt,
    builder: (column) => column,
  );

  GeneratedColumn<String> get blockKey =>
      $composableBuilder(column: $table.blockKey, builder: (column) => column);

  GeneratedColumn<int> get attempts =>
      $composableBuilder(column: $table.attempts, builder: (column) => column);

  GeneratedColumn<String> get state =>
      $composableBuilder(column: $table.state, builder: (column) => column);

  GeneratedColumn<String> get error =>
      $composableBuilder(column: $table.error, builder: (column) => column);
}

class $$OutboxTableTableManager
    extends
        RootTableManager<
          _$LocalDb,
          $OutboxTable,
          OutboxData,
          $$OutboxTableFilterComposer,
          $$OutboxTableOrderingComposer,
          $$OutboxTableAnnotationComposer,
          $$OutboxTableCreateCompanionBuilder,
          $$OutboxTableUpdateCompanionBuilder,
          (OutboxData, BaseReferences<_$LocalDb, $OutboxTable, OutboxData>),
          OutboxData,
          PrefetchHooks Function()
        > {
  $$OutboxTableTableManager(_$LocalDb db, $OutboxTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$OutboxTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$OutboxTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$OutboxTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<String> idempotencyKey = const Value.absent(),
                Value<String> kind = const Value.absent(),
                Value<String> payload = const Value.absent(),
                Value<String> label = const Value.absent(),
                Value<DateTime> happenedAt = const Value.absent(),
                Value<String?> blockKey = const Value.absent(),
                Value<int> attempts = const Value.absent(),
                Value<String> state = const Value.absent(),
                Value<String?> error = const Value.absent(),
              }) => OutboxCompanion(
                id: id,
                idempotencyKey: idempotencyKey,
                kind: kind,
                payload: payload,
                label: label,
                happenedAt: happenedAt,
                blockKey: blockKey,
                attempts: attempts,
                state: state,
                error: error,
              ),
          createCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                required String idempotencyKey,
                required String kind,
                required String payload,
                required String label,
                required DateTime happenedAt,
                Value<String?> blockKey = const Value.absent(),
                Value<int> attempts = const Value.absent(),
                Value<String> state = const Value.absent(),
                Value<String?> error = const Value.absent(),
              }) => OutboxCompanion.insert(
                id: id,
                idempotencyKey: idempotencyKey,
                kind: kind,
                payload: payload,
                label: label,
                happenedAt: happenedAt,
                blockKey: blockKey,
                attempts: attempts,
                state: state,
                error: error,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$OutboxTableProcessedTableManager =
    ProcessedTableManager<
      _$LocalDb,
      $OutboxTable,
      OutboxData,
      $$OutboxTableFilterComposer,
      $$OutboxTableOrderingComposer,
      $$OutboxTableAnnotationComposer,
      $$OutboxTableCreateCompanionBuilder,
      $$OutboxTableUpdateCompanionBuilder,
      (OutboxData, BaseReferences<_$LocalDb, $OutboxTable, OutboxData>),
      OutboxData,
      PrefetchHooks Function()
    >;
typedef $$SyncStateTableCreateCompanionBuilder =
    SyncStateCompanion Function({
      required String tableKey,
      Value<DateTime?> lastSyncedAt,
      Value<int> rowid,
    });
typedef $$SyncStateTableUpdateCompanionBuilder =
    SyncStateCompanion Function({
      Value<String> tableKey,
      Value<DateTime?> lastSyncedAt,
      Value<int> rowid,
    });

class $$SyncStateTableFilterComposer
    extends Composer<_$LocalDb, $SyncStateTable> {
  $$SyncStateTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get tableKey => $composableBuilder(
    column: $table.tableKey,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get lastSyncedAt => $composableBuilder(
    column: $table.lastSyncedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$SyncStateTableOrderingComposer
    extends Composer<_$LocalDb, $SyncStateTable> {
  $$SyncStateTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get tableKey => $composableBuilder(
    column: $table.tableKey,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get lastSyncedAt => $composableBuilder(
    column: $table.lastSyncedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$SyncStateTableAnnotationComposer
    extends Composer<_$LocalDb, $SyncStateTable> {
  $$SyncStateTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get tableKey =>
      $composableBuilder(column: $table.tableKey, builder: (column) => column);

  GeneratedColumn<DateTime> get lastSyncedAt => $composableBuilder(
    column: $table.lastSyncedAt,
    builder: (column) => column,
  );
}

class $$SyncStateTableTableManager
    extends
        RootTableManager<
          _$LocalDb,
          $SyncStateTable,
          SyncStateData,
          $$SyncStateTableFilterComposer,
          $$SyncStateTableOrderingComposer,
          $$SyncStateTableAnnotationComposer,
          $$SyncStateTableCreateCompanionBuilder,
          $$SyncStateTableUpdateCompanionBuilder,
          (
            SyncStateData,
            BaseReferences<_$LocalDb, $SyncStateTable, SyncStateData>,
          ),
          SyncStateData,
          PrefetchHooks Function()
        > {
  $$SyncStateTableTableManager(_$LocalDb db, $SyncStateTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$SyncStateTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$SyncStateTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$SyncStateTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> tableKey = const Value.absent(),
                Value<DateTime?> lastSyncedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => SyncStateCompanion(
                tableKey: tableKey,
                lastSyncedAt: lastSyncedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String tableKey,
                Value<DateTime?> lastSyncedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => SyncStateCompanion.insert(
                tableKey: tableKey,
                lastSyncedAt: lastSyncedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$SyncStateTableProcessedTableManager =
    ProcessedTableManager<
      _$LocalDb,
      $SyncStateTable,
      SyncStateData,
      $$SyncStateTableFilterComposer,
      $$SyncStateTableOrderingComposer,
      $$SyncStateTableAnnotationComposer,
      $$SyncStateTableCreateCompanionBuilder,
      $$SyncStateTableUpdateCompanionBuilder,
      (
        SyncStateData,
        BaseReferences<_$LocalDb, $SyncStateTable, SyncStateData>,
      ),
      SyncStateData,
      PrefetchHooks Function()
    >;

class $LocalDbManager {
  final _$LocalDb _db;
  $LocalDbManager(this._db);
  $$MaterialsTableTableManager get materials =>
      $$MaterialsTableTableManager(_db, _db.materials);
  $$MaterialBatchesTableTableManager get materialBatches =>
      $$MaterialBatchesTableTableManager(_db, _db.materialBatches);
  $$MaterialContainersTableTableManager get materialContainers =>
      $$MaterialContainersTableTableManager(_db, _db.materialContainers);
  $$OutboxTableTableManager get outbox =>
      $$OutboxTableTableManager(_db, _db.outbox);
  $$SyncStateTableTableManager get syncState =>
      $$SyncStateTableTableManager(_db, _db.syncState);
}
