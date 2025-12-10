import { randomUUID } from 'crypto'
import * as xdebug from './xdebugConnection'

const recursionMagic = `---MAGIC---${randomUUID()}---MAGIC---`

/**
 * Generate a JSON object and pretty print it
 */
export async function varJsonProperty(property: xdebug.Property): Promise<string> {
    const obj = await _varJsonProperty(property)
    const json = JSON.stringify(obj, null, ' ')
    return json.replace(new RegExp(`"${recursionMagic}"`, 'g'), '...')
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function _varJsonProperty(property: xdebug.Property, depth: number = 0): Promise<any> {
    if (depth >= 20) {
        // prevent infinite recursion
        return recursionMagic
    }

    let displayValue: string
    if (property.hasChildren || property.type === 'array' || property.type === 'object') {
        let properties: xdebug.Property[]
        if (property.hasChildren) {
            if (property.children.length === property.numberOfChildren) {
                properties = property.children
            } else {
                // TODO: also take into account the number of children for pagination
                properties = await property.getChildren()
            }
        } else {
            properties = []
        }

        const obj = await Promise.all(
            properties.map(async property => {
                return [property.name, <object>await _varJsonProperty(property, depth + 1)]
            })
        )

        // TODO: handle only numeric, sequential arrays?

        return <object>Object.fromEntries(obj)
    } else {
        // for null, uninitialized, resource, etc. show the type
        displayValue = property.value || property.type === 'string' ? property.value : property.type
        if (property.type === 'string') {
            // escaping ?
            if (property.size > property.value.length) {
                // get value
                const p2 = await property.context.stackFrame.connection.sendPropertyValueNameCommand(
                    property.fullName,
                    property.context
                )
                displayValue = p2.value
            }
            return displayValue
        } else if (property.type === 'bool') {
            return Boolean(parseInt(displayValue, 10))
        } else if (property.type === 'int') {
            return parseInt(displayValue, 10)
        } else if (property.type === 'float' || property.type === 'double') {
            return parseFloat(displayValue)
        } else {
            return property.value
        }
    }
}
