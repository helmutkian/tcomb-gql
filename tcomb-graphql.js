const t = require('tcomb');
const graphql = require('graphql');
const _ = require('lodash');

const {
  GraphQLObjectType: gqlObject,
  GraphQLUnionType: gqlUnion,
  GraphQLList: gqlList,
  GraphQLNonNull: gqlNonNull,
  GraphQLInterfaceType: gqlInterface,
  GraphQLEnumType: gqlEnum,
  GraphQLString: gqlString,
  GraphQLBoolean: gqlBoolean,
  GraphQLInt: gqlInt,
  GraphQLFloat: gqlFloat,
  GraphQLID: gqlID
} = graphql;

const ID = t.refinement(t.String, () => true, 'ID');

function gqlTypeGenerator(type) {
  return isNonNullable => 
    isNonNullable ? gqlNonNull(type) : type;
}

const builtinGenerators = {
  String: gqlTypeGenerator(gqlString),
  Number: gqlTypeGenerator(gqlFloat),
  Integer: gqlTypeGenerator(gqlInt),
  Boolean: gqlTypeGenerator(gqlBoolean),
  ID: gqlTypeGenerator(gqlID)
};


function mergeGenerators(lhs, rhs) {
  return Object.assign({}, lhs, rhs);
}

function withGraphQLInterface(type) {
  const isValidType = ['struct', 'interface'].indexOf(type.meta.kind) >= 0;
  const typeName = type.meta.name;

  if (!isValidType) {
    throw new Error('tcomb type must be struct or interface');
  } else if (!typeName) {
    throw new Error('tcomb type must have a name');
  }

  const graphqlInterfaceType = t.refinement(type, () => true, '_GraphQLInterface_' + type.meta.name);

  graphqlInterfaceType.meta.__isGraphQLInterface = true;

  return graphqlInterfaceType;
}

function isGraphQLInterface(type) {
  return type.meta.kind === 'subtype' && type.meta.__isGraphQLInterface;
}

class TCombGraphQLGenerator {

  constructor(generators) {
    this._generators = TCombGraphQLGenerator.mergeGenerators(builtinGenerators, generators);
    this._fieldGenerators = [];
  }

  _matchTypeGenerator(type) {
    return this._generators[type.meta.name];
  }

  _withNamedType(type, isField, generate) {
    const typeName = type.meta.name;

    if (!typeName) {
      throw new Error('tcomb structs and interfaces must have name');
    }

    const generatedType = generate(type);
    const typeGenerator = this._matchTypeGenerator(type) || gqlTypeGenerator(generatedType);

    this._generators[typeName] = typeGenerator;
    
    if (isField) {
      this._fieldGenerators.push(typeGenerator);
    }

    return typeGenerator;
  }

  generate(type) {
    const generatedType = this._generate(type);

    return [generatedType].concat(
      this._fieldGenerators.map(generator => generator())
    );
  }

  _generate(type, isNonNullable, isField) {
    const typeGenerator = this._matchTypeGenerator(type);

    if (typeGenerator) {
      return typeGenerator(isNonNullable);
    }

    switch (type.meta.kind) {
      case 'maybe':
        return this._generate(type.meta.type, false, isField);

      case 'struct':
      case 'interface':
        return this._generateGraphQLNamedType(
          gqlObject, 
          type, 
          isNonNullable,
          isField
        );
      case 'list':
        return new gqlList(this._generate(type.meta.type, isNonNullable, isField));
      case 'enums':
      case 'union':
      case 'subtype':
        const isInterface = isGraphQLInterface(type);

        if (isInterface) {
          return this._generateGraphQLNamedType(
            gqlInterface, 
            type.meta.type,
            isNonNullable,
            isField
          );
        }
        //else fall thru to default

      default: 
        throw new Error('Type not supported ' + type.toString());
    }
  }

  _generateGraphQLNamedType(gqlType, type, isNonNullable, isField) {

    const fields =_.mapValues(
      type.meta.props, 
      prop => ({
        type: this._generate(prop, true, true)
      })
    );

    const typeGenerator = this._withNamedType(type, isField, () =>
      new gqlType({
        name: type.meta.name,
        fields: () => fields
      })
    );

    return typeGenerator(isNonNullable);
  }
}

function test() {
  const generator = new TCombGraphQLGenerator();
  const Bar = t.struct({ quux: t.Boolean }, 'Bar');
  const type = withGraphQLInterface(t.struct({
    bar: Bar,
    baz: t.maybe(t.Integer),
    id: t.maybe(t.list(ID))
  }, 'Foo'));
  const generatedTypes = generator.generate(type);

  generatedTypes
    .map(type => graphql.printType(type))
    .forEach(s => console.log(s));


  // return generatedTypes.forEach(type => graphql.printType(type));
}

TCombGraphQLGenerator.mergeGenerators = mergeGenerators;
TCombGraphQLGenerator.test = test;

module.exports = TCombGraphQLGenerator;